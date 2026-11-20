
#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "HX711.h"
#include <math.h>
#include <string.h>

// ==================== GLOBALS & HARDWARE ==================== THIS IS THE LAST

// TF-Luna uses Arduino Mega hardware Serial1
// RX1 = Pin 19
// TX1 = Pin 18

Adafruit_MLX90614 mlx;
MAX30105 particleSensor;
HX711 scale;

// HX711 pins
const int DT_PIN = 3;
const int SCK_PIN = 2;
// Matched to weight_only: calibrated in grams, reported in kg.
// Adjusted: 2.000 kg known read as 4.967 kg with 8.8760
// → 8.8760 * (4.967 / 2.000) = 22.0435
float calibrationFactor = 22.0435;

bool temperatureSensorReady = false;
bool heightSensorReady = false;
bool max30105SensorReady = false;
bool weightSensorReady = false;

// Serial command buffer
char commandBuffer[64];
size_t commandLength = 0;
bool commandTooLong = false;

// ==================== HEIGHT CONFIGURATION ====================

// TF-Luna on Serial1 (Mega RX1=19, TX1=18), default UART 115200
#define TFLUNA Serial1

// TF-Luna mounting height above platform
const float SENSOR_HEIGHT_CM = 227.0;
const int MIN_HEIGHT_CM = 50;
const int MAX_HEIGHT_CM = 220;

const int HEIGHT_BUFFER_SIZE = 5;
const unsigned long HEIGHT_TIMEOUT = 6000;

byte tfFrame[9];
byte tfFrameIndex = 0;

// ==================== MAX30105 VARIABLES ====================

const byte RATE_SIZE = 8;
byte rates[RATE_SIZE];
byte rateSpot = 0;
long lastBeat = 0;
float bpm = 0;
int avgBpm = 0;
int validBeats = 0;

const int BUFFER_SIZE = 50;
long irBuffer[BUFFER_SIZE];
long redBuffer[BUFFER_SIZE];
int maxBufferIndex = 0;
float spO2 = 0;

long irValue = 0, redValue = 0;
const long FINGER_THRESHOLD = 50000;

bool maxMeasurementRequested = false;
bool maxMeasurementRequiresResp = false;

unsigned long lastMaxPoll = 0;
const unsigned long MAX_POLL_INTERVAL = 20;

unsigned long maxMeasurementStartTime = 0;
const unsigned long MAX_MEASUREMENT_DURATION = 40000;

// Respiratory-rate estimate from PPG baseline modulation (breaths/min)
float irEmaFast = 0;
float irEmaSlow = 0;
bool irEmaReady = false;
bool respPeakArmed = true;
unsigned long lastRespPeakMs = 0;
const unsigned long RESP_MIN_INTERVAL_MS = 2000;   // <= 30 breaths/min
const unsigned long RESP_MAX_INTERVAL_MS = 10000;  // >= 6 breaths/min
const float RESP_PEAK_THRESHOLD = 120.0f;
const byte RESP_RATE_SIZE = 6;
byte respRates[RESP_RATE_SIZE];
byte respRateSpot = 0;
int validRespPeaks = 0;
int avgRespRate = 0;

// ==================== HELPERS ====================

bool waitForHx711(unsigned long timeoutMs) {
  unsigned long start = millis();
  while (!scale.is_ready()) {
    if (millis() - start >= timeoutMs) {
      return false;
    }
    delay(1);
  }
  return true;
}

bool initWeightSensor() {
  scale.begin(DT_PIN, SCK_PIN);
  delay(300);

  if (!waitForHx711(1000)) {
    return false;
  }

  scale.set_scale(calibrationFactor);
  scale.tare(10);
  return true;
}

// Returns weight in kilograms (calibration factor is based on grams).
float readWeightKg() {
  float weightKg = scale.get_units(10) / 1000.0f;

  // Soft zero-band (~±0.6 g)
  if (weightKg > -0.0006f && weightKg < 0.0006f) {
    weightKg = 0.0f;
  }

  return weightKg;
}

// Streaming TF-Luna frame reader (header 0x59 0x59 + checksum).
bool readTFLuna(int &distance, int &strength) {
  while (TFLUNA.available() > 0) {
    byte incoming = TFLUNA.read();

    if (tfFrameIndex == 0 && incoming != 0x59) {
      continue;
    }

    if (tfFrameIndex == 1 && incoming != 0x59) {
      tfFrameIndex = 0;
      continue;
    }

    tfFrame[tfFrameIndex++] = incoming;

    if (tfFrameIndex == 9) {
      tfFrameIndex = 0;

      byte checksum = 0;
      for (int i = 0; i < 8; i++) {
        checksum += tfFrame[i];
      }

      if (checksum != tfFrame[8]) {
        return false;
      }

      distance = tfFrame[2] | (tfFrame[3] << 8);
      strength = tfFrame[4] | (tfFrame[5] << 8);
      return true;
    }
  }

  return false;
}

float medianFilter(float values[], int size) {
  float temp[HEIGHT_BUFFER_SIZE];

  if (size <= 0) {
    return 0;
  }
  if (size > HEIGHT_BUFFER_SIZE) {
    size = HEIGHT_BUFFER_SIZE;
  }

  for (int i = 0; i < size; i++) {
    temp[i] = values[i];
  }

  for (int i = 0; i < size - 1; i++) {
    for (int j = i + 1; j < size; j++) {
      if (temp[j] < temp[i]) {
        float t = temp[i];
        temp[i] = temp[j];
        temp[j] = t;
      }
    }
  }

  return temp[size / 2];
}

void initHeightSensor() {
  TFLUNA.begin(115200);
  tfFrameIndex = 0;
  while (TFLUNA.available() > 0) {
    TFLUNA.read();
  }
  heightSensorReady = true;
}

void emitSystemReady();

void resetMaxMeasurementState() {

  bpm = avgBpm = spO2 = 0;
  avgRespRate = 0;

  rateSpot = validBeats = maxBufferIndex = 0;
  respRateSpot = validRespPeaks = 0;

  irEmaFast = irEmaSlow = 0;
  irEmaReady = false;
  respPeakArmed = true;
  lastRespPeakMs = 0;

  memset(rates, 0, sizeof(rates));
  memset(respRates, 0, sizeof(respRates));

  for (int i = 0; i < BUFFER_SIZE; i++) {
    irBuffer[i] = 0;
    redBuffer[i] = 0;
  }
}

void updateRespiratoryEstimate(long irSample) {

  const float alphaFast = 0.18f;
  const float alphaSlow = 0.02f;

  if (!irEmaReady) {
    irEmaFast = (float)irSample;
    irEmaSlow = (float)irSample;
    irEmaReady = true;
    return;
  }

  irEmaFast = alphaFast * (float)irSample + (1.0f - alphaFast) * irEmaFast;
  irEmaSlow = alphaSlow * (float)irSample + (1.0f - alphaSlow) * irEmaSlow;

  float band = irEmaFast - irEmaSlow;

  if (respPeakArmed && band > RESP_PEAK_THRESHOLD) {
    unsigned long nowMs = millis();

    if (lastRespPeakMs > 0) {
      unsigned long delta = nowMs - lastRespPeakMs;

      if (delta >= RESP_MIN_INTERVAL_MS && delta <= RESP_MAX_INTERVAL_MS) {
        float breathsPerMin = 60000.0f / (float)delta;
        byte rounded = (byte)(breathsPerMin + 0.5f);

        if (rounded >= 6 && rounded <= 40) {
          respRates[respRateSpot++] = rounded;
          respRateSpot %= RESP_RATE_SIZE;

          if (validRespPeaks < RESP_RATE_SIZE) {
            validRespPeaks++;
          }

          int sum = 0;
          for (byte i = 0; i < validRespPeaks; i++) {
            byte index = (respRateSpot + RESP_RATE_SIZE - 1 - i) % RESP_RATE_SIZE;
            sum += respRates[index];
          }

          avgRespRate = sum / validRespPeaks;
        }
      }
    }

    lastRespPeakMs = nowMs;
    respPeakArmed = false;
  } else if (!respPeakArmed && band < -(RESP_PEAK_THRESHOLD * 0.35f)) {
    respPeakArmed = true;
  }
}

void emitMax30105Results() {

  bool hasHr = avgBpm > 0;
  bool hasSpo2 = spO2 > 0;
  bool hasResp = avgRespRate > 0;

  if (!hasHr && !hasSpo2 && !hasResp) {
    Serial.println(
      "ERROR:MAX30105 measurement timeout or no finger detected"
    );
    return;
  }

  if (hasHr) {
    Serial.print("HR_RESULT:");
    Serial.println(avgBpm);
  }

  if (hasSpo2) {
    Serial.print("SPO2_RESULT:");
    Serial.println(spO2, 1);
  }

  if (hasResp) {
    Serial.print("RESP_RESULT:");
    Serial.println(avgRespRate);
  }
}

void startMax30105Measurement(bool requireResp) {

  if (!max30105SensorReady) {

    Serial.println("STATUS:Retrying MAX30105 sensor initialization...");

    max30105SensorReady =
      particleSensor.begin(Wire, I2C_SPEED_STANDARD);

    if (!max30105SensorReady) {
      Serial.println("ERROR:MAX30105 initialization failed");
      return;
    }

    particleSensor.setup(60, 4, 2, 100, 411, 4096);

    particleSensor.setPulseAmplitudeRed(0x0A);
    particleSensor.setPulseAmplitudeGreen(0);
  }

  Serial.println("STATUS:Starting MAX30105 measurement...");

  resetMaxMeasurementState();

  maxMeasurementRequested = true;
  maxMeasurementRequiresResp = requireResp;

  maxMeasurementStartTime = millis();
}

float calculateSpO2() {

  long irMax = 0;
  long irMin = 2147483647L;

  long redMax = 0;
  long redMin = 2147483647L;

  long irSum = 0;
  long redSum = 0;

  for (int i = 0; i < BUFFER_SIZE; i++) {

    irSum += irBuffer[i];
    redSum += redBuffer[i];

    if (irBuffer[i] > irMax) irMax = irBuffer[i];
    if (irBuffer[i] < irMin) irMin = irBuffer[i];

    if (redBuffer[i] > redMax) redMax = redBuffer[i];
    if (redBuffer[i] < redMin) redMin = redBuffer[i];
  }

  float irDC = irSum / (float)BUFFER_SIZE;
  float redDC = redSum / (float)BUFFER_SIZE;

  float irAC = irMax - irMin;
  float redAC = redMax - redMin;

  if (irDC == 0 || redDC == 0 || irAC == 0) {
    return 0;
  }

  float R = (redAC / redDC) / (irAC / irDC);

  float spo2 = 110.0f - 25.0f * R;

  if (spo2 > 100) spo2 = 100;
  if (spo2 < 70) spo2 = 70;

  return spo2;
}

// ==================== COMMAND HANDLER ====================

void handleCommand(const char* command) {

  Serial.print("DEBUG:Received command: [");
  Serial.print(command);
  Serial.println("]");

  // ==================== TEMPERATURE ====================

  if (strcmp(command, "MEASURE_TEMPERATURE") == 0) {

    if (!temperatureSensorReady) {

      Serial.println("STATUS:Retrying temperature sensor initialization...");

      temperatureSensorReady = mlx.begin();

      if (!temperatureSensorReady) {
        Serial.println("ERROR:MLX90614 initialization failed");
        return;
      }
    }

    float tempObj = mlx.readObjectTempC();
    float tempAmb = mlx.readAmbientTempC();

    Serial.print("DEBUG:Raw Ambient Temp (C): ");
    Serial.println(tempAmb);

    Serial.print("DEBUG:Raw Object Temp (C): ");
    Serial.println(tempObj);

    if (isnan(tempObj) || isinf(tempObj) ||
        isnan(tempAmb) || isinf(tempAmb)) {

      Serial.println("ERROR:Temperature reading invalid");
      return;
    }

    Serial.print("TEMPERATURE_RESULT:");
    Serial.println(tempObj, 1);
  }

  // ==================== TF-LUNA HEIGHT ====================

  else if (strcmp(command, "MEASURE_HEIGHT") == 0) {

    if (!heightSensorReady) {
      Serial.println("STATUS:Retrying height sensor initialization...");
      initHeightSensor();
    }

    Serial.println("STATUS:Starting height measurement...");

    // Reset frame sync and drain stale UART bytes
    tfFrameIndex = 0;
    while (TFLUNA.available() > 0) {
      TFLUNA.read();
    }

    float sampleBuffer[HEIGHT_BUFFER_SIZE];
    int sampleCount = 0;
    int distance = 0;
    int strength = 0;

    unsigned long startTime = millis();

    while (millis() - startTime < HEIGHT_TIMEOUT) {

      if (!readTFLuna(distance, strength)) {
        continue;
      }

      if (distance <= 0 ||
          distance >= SENSOR_HEIGHT_CM ||
          strength <= 0) {
        continue;
      }

      float calculatedHeight = SENSOR_HEIGHT_CM - distance;

      if (calculatedHeight < MIN_HEIGHT_CM ||
          calculatedHeight > MAX_HEIGHT_CM) {
        continue;
      }

      if (sampleCount < HEIGHT_BUFFER_SIZE) {
        sampleBuffer[sampleCount++] = calculatedHeight;
      }

      if (sampleCount >= HEIGHT_BUFFER_SIZE) {
        float finalHeight =
          medianFilter(sampleBuffer, HEIGHT_BUFFER_SIZE);

        Serial.print("HEIGHT_RESULT:");
        Serial.println(finalHeight, 1);
        return;
      }
    }

    if (sampleCount > 0) {
      float fallbackHeight = medianFilter(sampleBuffer, sampleCount);

      Serial.print("HEIGHT_RESULT:");
      Serial.println(fallbackHeight, 1);
      Serial.println("STATUS:Height measurement completed (fallback)");
    } else {
      Serial.println("HEIGHT_RESULT:0");
      Serial.println(
        "ERROR:Height measurement timeout - no valid target detected"
      );
    }
  }

  // ==================== MAX30105 HEART RATE, SPO2, RESPIRATORY RATE ====================

  else if (strcmp(command, "MEASURE_MAX30105") == 0) {

    startMax30105Measurement(false);
  }

  else if (strcmp(command, "MEASURE_RESPIRATORY_RATE") == 0 ||
           strcmp(command, "MEASURE_RESP") == 0) {

    startMax30105Measurement(true);
  }

  // ==================== WEIGHT ====================

  else if (strcmp(command, "MEASURE_WEIGHT") == 0) {

    if (!weightSensorReady) {

      Serial.println("STATUS:Retrying weight sensor initialization...");

      weightSensorReady = initWeightSensor();

      if (!weightSensorReady) {
        Serial.println("ERROR:HX711 initialization failed");
        return;
      }

      Serial.println("STATUS:Scale tared");
    }

    if (!waitForHx711(1000)) {
      Serial.println("ERROR:HX711 not ready");
      return;
    }

    float weight = readWeightKg();

    Serial.print("WEIGHT_RESULT:");
    Serial.print(weight, 3);
    Serial.println(" kg");
  }

  // ==================== TARE SCALE ====================

  else if (strcmp(command, "TARE_SCALE") == 0) {

    if (!weightSensorReady) {
      Serial.println("ERROR:Scale not ready for taring");
      return;
    }

    if (!waitForHx711(1000)) {
      Serial.println("ERROR:Scale not ready for taring");
      return;
    }

    scale.tare(15);
    Serial.println("STATUS:Scale tared successfully");
  }

  // ==================== READY / STATUS / PING ====================
  // Kiosk may miss boot-time "System ready" (Web Serial open often resets
  // the board, or the message arrives before the reader is attached).

  else if (strcmp(command, "REFRESH") == 0 ||
           strcmp(command, "STATUS") == 0 ||
           strcmp(command, "PING") == 0) {

    if (maxMeasurementRequested) {
      maxMeasurementRequested = false;
      maxMeasurementRequiresResp = false;
      resetMaxMeasurementState();
      Serial.println("STATUS:MAX30105 measurement cancelled");
    }

    Serial.println("STATUS:Refresh acknowledged");
    emitSystemReady();
  }

  else {

    Serial.println("ERROR:Unknown command");
  }
}

void emitSystemReady() {
  // Always advertise readiness so the kiosk can talk to us.
  // Per-command paths already retry sensors that failed at boot.
  Serial.println("STATUS:System ready");

  Serial.print("STATUS:Sensors temp=");
  Serial.print(temperatureSensorReady ? "ok" : "fail");
  Serial.print(" height=");
  Serial.print(heightSensorReady ? "ok" : "fail");
  Serial.print(" max30105=");
  Serial.print(max30105SensorReady ? "ok" : "fail");
  Serial.print(" weight=");
  Serial.println(weightSensorReady ? "ok" : "fail");
}

// ==================== SETUP ====================

void setup() {

  // USB serial communication with MediPoint
  Serial.begin(9600);

  // Give the USB CDC / host a moment after Web Serial open (which often
  // resets the Mega) so the first STATUS lines are not lost.
  delay(300);

  // I2C communication for MLX90614 and MAX30105
  Wire.begin();

  Serial.println("STATUS:Initializing MediPoint sensors...");

  // 1. Initialize Temperature Sensor
  temperatureSensorReady = mlx.begin();

  if (!temperatureSensorReady) {
    Serial.println("ERROR:MLX90614 initialization failed");
  }

  // 2. Initialize TF-Luna (115200 UART on Serial1)
  initHeightSensor();

  // 3. Initialize MAX30105 Sensor
  if (particleSensor.begin(Wire, I2C_SPEED_STANDARD)) {

    max30105SensorReady = true;

    particleSensor.setup(60, 4, 2, 100, 411, 4096);

    particleSensor.setPulseAmplitudeRed(0x0A);
    particleSensor.setPulseAmplitudeGreen(0);
  }
  else {

    Serial.println("ERROR:MAX30105 initialization failed");
  }

  // 4. Initialize Weight Sensor — keep this short.
  // A long tare delay here races the kiosk's ready timeout (Web Serial
  // open resets the board, so setup starts when the browser connects).
  weightSensorReady = initWeightSensor();

  if (weightSensorReady) {
    Serial.println("STATUS:Scale tared");
  } else {
    Serial.println("ERROR:HX711 initialization failed");
  }

  if (!temperatureSensorReady ||
      !heightSensorReady ||
      !max30105SensorReady ||
      !weightSensorReady) {
    Serial.println("ERROR:One or more sensors failed initialization");
  }

  // Always emit System ready so the kiosk handshake can complete.
  // Failed sensors are retried when their MEASURE_* command arrives.
  emitSystemReady();
}

// ==================== LOOP ====================

void loop() {

  // Handle incoming commands from MediPoint through USB Serial
  while (Serial.available() > 0) {

    char incoming = (char)Serial.read();

    if (incoming == '\r') {
      continue;
    }

    if (incoming == '\n') {

      if (commandTooLong) {

        Serial.println("ERROR:Command too long");
      }
      else if (commandLength > 0) {

        commandBuffer[commandLength] = '\0';

        handleCommand(commandBuffer);
      }

      commandLength = 0;
      commandTooLong = false;

      continue;
    }

    if (!commandTooLong) {

      if (commandLength < sizeof(commandBuffer) - 1) {

        commandBuffer[commandLength++] = incoming;
      }
      else {

        commandTooLong = true;
      }
    }
  }

  unsigned long now = millis();

  // Background MAX30105 sampling (HR, SpO2, and respiratory rate)
  if (maxMeasurementRequested) {

    unsigned long maxElapsed = now - maxMeasurementStartTime;

    if (maxElapsed > MAX_MEASUREMENT_DURATION) {

      emitMax30105Results();

      maxMeasurementRequested = false;

      return;
    }

    // Finish early once we have stable vitals so the kiosk is not
    // forced to wait the full 40s every time.
    bool hasStableHrSpo2 =
      avgBpm > 0 && spO2 > 0 && validBeats >= RATE_SIZE;
    bool hasResp = avgRespRate > 0;

    if (maxElapsed >= 12000UL && hasStableHrSpo2 &&
        (!maxMeasurementRequiresResp || hasResp)) {

      emitMax30105Results();

      maxMeasurementRequested = false;

      return;
    }

    if (now - lastMaxPoll >= MAX_POLL_INTERVAL) {

      lastMaxPoll = now;

      particleSensor.check();

      while (particleSensor.available()) {

        irValue = particleSensor.getFIFOIR();
        redValue = particleSensor.getFIFORed();

        particleSensor.nextSample();

        if (irValue < FINGER_THRESHOLD) {

          resetMaxMeasurementState();

          continue;
        }

        irBuffer[maxBufferIndex] = irValue;
        redBuffer[maxBufferIndex] = redValue;

        maxBufferIndex = (maxBufferIndex + 1) % BUFFER_SIZE;

        updateRespiratoryEstimate(irValue);

        if (checkForBeat(irValue)) {

          long delta = millis() - lastBeat;

          lastBeat = millis();

          if (delta > 0) {

            bpm = 60.0f / (delta / 1000.0f);

            if (bpm >= 20 && bpm <= 250) {

              rates[rateSpot++] = (byte)bpm;

              rateSpot %= RATE_SIZE;

              if (validBeats < RATE_SIZE) {
                validBeats++;
              }

              avgBpm = 0;

              for (byte i = 0; i < RATE_SIZE; i++) {
                avgBpm += rates[i];
              }

              avgBpm /= RATE_SIZE;
            }
          }
        }

        spO2 = calculateSpO2();
      }
    }
  }
}
