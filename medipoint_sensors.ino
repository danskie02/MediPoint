
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
float calibrationFactor = 23018.0;

bool temperatureSensorReady = false;
bool heightSensorReady = false;
bool max30105SensorReady = false;
bool weightSensorReady = false;

// Serial command buffer
char commandBuffer[64];
size_t commandLength = 0;
bool commandTooLong = false;

// ==================== HEIGHT CONFIGURATION ====================

// TF-Luna mounting height above platform
const float SENSOR_HEIGHT_CM = 227.0;

const int QUICK_BUFFER_SIZE = 5;
const unsigned long HEIGHT_TIMEOUT = 6000;

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

float medianFilter(float values[], int size) {

  float temp[5];

  for (int i = 0; i < size && i < 5; i++) {
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

void startMax30105Measurement() {

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

      Serial1.begin(9600);
      heightSensorReady = true;
    }

    Serial.println("STATUS:Starting height measurement...");

    byte buffer[9];

    int distance = 0;
    int strength = 0;

    float sampleBuffer[QUICK_BUFFER_SIZE];

    int sampleCount = 0;

    unsigned long startTime = millis();

    while (millis() - startTime < HEIGHT_TIMEOUT) {

      while (Serial1.available() > 0) {

        byte incomingByte = Serial1.read();

        // TF-Luna UART frame header: 0x59 0x59
        if (incomingByte == 0x59) {

          unsigned long headerStart = millis();

          while (Serial1.available() < 1 &&
                 millis() - headerStart < 30) {
          }

          if (Serial1.available() == 0) {
            continue;
          }

          byte secondHeader = Serial1.read();

          if (secondHeader != 0x59) {
            continue;
          }

          buffer[0] = 0x59;
          buffer[1] = 0x59;

          // Read remaining 7 bytes
          bool frameComplete = true;

          unsigned long frameStart = millis();

          for (int i = 2; i < 9; i++) {

            while (Serial1.available() < 1 &&
                   millis() - frameStart < 50) {
            }

            if (Serial1.available() == 0) {
              frameComplete = false;
              break;
            }

            buffer[i] = Serial1.read();
          }

          if (!frameComplete) {
            continue;
          }

          // Validate checksum
          byte checksum = 0;

          for (int i = 0; i < 8; i++) {
            checksum += buffer[i];
          }

          if (checksum != buffer[8]) {
            continue;
          }

          // Distance in centimeters
          distance = buffer[2] | (buffer[3] << 8);

          // Signal strength
          strength = buffer[4] | (buffer[5] << 8);

          if (distance >= 1 &&
              distance < SENSOR_HEIGHT_CM &&
              strength > 0) {

            // Height = mounting height - measured distance
            // No offset applied

            float calculatedHeight =
              SENSOR_HEIGHT_CM - distance;

            if (calculatedHeight >= 50.0 &&
                calculatedHeight <= 220.0 &&
                sampleCount < QUICK_BUFFER_SIZE) {

              sampleBuffer[sampleCount++] = calculatedHeight;

              // Collect five valid readings
              if (sampleCount >= QUICK_BUFFER_SIZE) {

                float finalHeight =
                  medianFilter(sampleBuffer, QUICK_BUFFER_SIZE);

                Serial.print("HEIGHT_RESULT:");
                Serial.println(finalHeight, 1);

                return;
              }
            }
          }
        }
      }
    }

    // Return available readings if timeout occurs
    if (sampleCount > 0) {

      float fallbackHeight =
        medianFilter(sampleBuffer, sampleCount);

      Serial.print("HEIGHT_RESULT:");
      Serial.println(fallbackHeight, 1);

      Serial.println("STATUS:Height measurement completed (fallback)");
    }
    else {

      Serial.println("HEIGHT_RESULT:0");

      Serial.println(
        "ERROR:Height measurement timeout - no valid target detected"
      );
    }
  }

  // ==================== MAX30105 HEART RATE, SPO2, RESPIRATORY RATE ====================

  else if (strcmp(command, "MEASURE_MAX30105") == 0 ||
           strcmp(command, "MEASURE_RESPIRATORY_RATE") == 0 ||
           strcmp(command, "MEASURE_RESP") == 0) {

    startMax30105Measurement();
  }

  // ==================== WEIGHT ====================

  else if (strcmp(command, "MEASURE_WEIGHT") == 0) {

    if (!weightSensorReady) {

      Serial.println("STATUS:Retrying weight sensor initialization...");

      scale.begin(DT_PIN, SCK_PIN);

      if (scale.is_ready()) {

        scale.set_scale(calibrationFactor);
        scale.tare(15);

        weightSensorReady = true;
      }
      else {

        Serial.println("ERROR:HX711 initialization failed");
        return;
      }
    }

    if (scale.is_ready()) {

      float weight = scale.get_units(15);

      // Soft zero-band adjustment
      if (weight > -0.60 && weight < 0.60) {
        weight = 0.0;
      }

      Serial.print("WEIGHT_RESULT:");
      Serial.println(weight, 2);
    }
    else {

      Serial.println("ERROR:HX711 not ready");
    }
  }

  // ==================== TARE SCALE ====================

  else if (strcmp(command, "TARE_SCALE") == 0) {

    if (weightSensorReady && scale.is_ready()) {

      scale.tare(15);

      Serial.println("STATUS:Scale tared successfully");
    }
    else {

      Serial.println("ERROR:Scale not ready for taring");
    }
  }

  // ==================== REFRESH ====================

  else if (strcmp(command, "REFRESH") == 0) {

    Serial.println("STATUS:Refresh acknowledged");
  }

  else {

    Serial.println("ERROR:Unknown command");
  }
}

// ==================== SETUP ====================

void setup() {

  // USB serial communication with MediPoint
  Serial.begin(9600);

  // TF-Luna hardware UART communication
  Serial1.begin(9600);

  // I2C communication for MLX90614 and MAX30105
  Wire.begin();

  Serial.println("STATUS:Initializing MediPoint sensors...");

  // 1. Initialize Temperature Sensor
  temperatureSensorReady = mlx.begin();

  if (!temperatureSensorReady) {
    Serial.println("ERROR:MLX90614 initialization failed");
  }

  // 2. Initialize TF-Luna
  heightSensorReady = true;

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

  // 4. Initialize Weight Sensor
  scale.begin(DT_PIN, SCK_PIN);

  delay(500);

  if (scale.is_ready()) {

    scale.set_scale(calibrationFactor);

    Serial.println(
      "STATUS:Keep the platform empty. Taring scale in 5 seconds..."
    );

    delay(5000);

    scale.tare(30);

    weightSensorReady = true;
  }
  else {

    Serial.println("ERROR:HX711 initialization failed");
  }

  // Final sensor readiness check
  if (temperatureSensorReady &&
      heightSensorReady &&
      max30105SensorReady &&
      weightSensorReady) {

    Serial.println("STATUS:System ready");
  }
  else {

    Serial.println("ERROR:One or more sensors failed initialization");
  }
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

    if (now - maxMeasurementStartTime > MAX_MEASUREMENT_DURATION) {

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
