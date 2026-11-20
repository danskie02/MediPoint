#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
#include <string.h>

MAX30105 particleSensor;

bool max30105SensorReady = false;

char commandBuffer[64];
size_t commandLength = 0;
bool commandTooLong = false;

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

// Live Serial Monitor readout
bool liveDisplay = true;
unsigned long lastLivePrint = 0;
const unsigned long LIVE_PRINT_INTERVAL_MS = 500;

void emitSystemReady() {
  Serial.println("STATUS:System ready");
  Serial.print("STATUS:Sensors max30105=");
  Serial.println(max30105SensorReady ? "ok" : "fail");
  Serial.println("STATUS:Live display ON (send LIVE_OFF / LIVE_ON)");
  Serial.println("STATUS:Commands: MEASURE_MAX30105 | MEASURE_RESP | MEASURE_RESPIRATORY_RATE");
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
  float spo2Value = 110.0f - 25.0f * R;

  if (spo2Value > 100) spo2Value = 100;
  if (spo2Value < 70) spo2Value = 70;

  return spo2Value;
}

void emitMax30105Results() {
  bool hasHr = avgBpm > 0;
  bool hasSpo2 = spO2 > 0;
  bool hasResp = avgRespRate > 0;

  if (!hasHr && !hasSpo2 && !hasResp) {
    Serial.println("ERROR:MAX30105 measurement timeout or no finger detected");
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

bool ensureMax30105Ready() {
  if (max30105SensorReady) {
    return true;
  }

  Serial.println("STATUS:Retrying MAX30105 sensor initialization...");

  max30105SensorReady = particleSensor.begin(Wire, I2C_SPEED_STANDARD);

  if (!max30105SensorReady) {
    Serial.println("ERROR:MAX30105 initialization failed");
    return false;
  }

  particleSensor.setup(60, 4, 2, 100, 411, 4096);
  particleSensor.setPulseAmplitudeRed(0x0A);
  particleSensor.setPulseAmplitudeGreen(0);
  return true;
}

void startMax30105Measurement(bool requireResp) {
  if (!ensureMax30105Ready()) {
    return;
  }

  Serial.println("STATUS:Starting MAX30105 measurement...");

  resetMaxMeasurementState();

  maxMeasurementRequested = true;
  maxMeasurementRequiresResp = requireResp;
  maxMeasurementStartTime = millis();
}

void printLiveReading() {
  if (!max30105SensorReady) {
    Serial.println("MAX_LIVE:ERROR not ready");
    return;
  }

  bool finger = irValue >= FINGER_THRESHOLD;

  Serial.print("MAX_LIVE:ir=");
  Serial.print(irValue);
  Serial.print(" red=");
  Serial.print(redValue);
  Serial.print(" finger=");
  Serial.print(finger ? "yes" : "no");
  Serial.print(" measuring=");
  Serial.print(maxMeasurementRequested ? "yes" : "no");
  Serial.print(" hr=");
  Serial.print(avgBpm);
  Serial.print(" spo2=");
  Serial.print(spO2, 1);
  Serial.print(" resp=");
  Serial.println(avgRespRate);
}

void processMax30105Samples() {
  particleSensor.check();

  while (particleSensor.available()) {
    irValue = particleSensor.getFIFOIR();
    redValue = particleSensor.getFIFORed();
    particleSensor.nextSample();

    if (!maxMeasurementRequested) {
      continue;
    }

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

void handleCommand(const char* command) {
  Serial.print("DEBUG:Received command: [");
  Serial.print(command);
  Serial.println("]");

  if (strcmp(command, "MEASURE_MAX30105") == 0) {
    startMax30105Measurement(false);
  }
  else if (strcmp(command, "MEASURE_RESPIRATORY_RATE") == 0 ||
           strcmp(command, "MEASURE_RESP") == 0) {
    startMax30105Measurement(true);
  }
  else if (strcmp(command, "LIVE_ON") == 0) {
    liveDisplay = true;
    Serial.println("STATUS:Live display ON");
  }
  else if (strcmp(command, "LIVE_OFF") == 0) {
    liveDisplay = false;
    Serial.println("STATUS:Live display OFF");
  }
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

void setup() {
  Serial.begin(9600);
  delay(300);

  Wire.begin();

  Serial.println("STATUS:Initializing MAX30105 sensor...");

  if (particleSensor.begin(Wire, I2C_SPEED_STANDARD)) {
    max30105SensorReady = true;
    particleSensor.setup(60, 4, 2, 100, 411, 4096);
    particleSensor.setPulseAmplitudeRed(0x0A);
    particleSensor.setPulseAmplitudeGreen(0);
  } else {
    Serial.println("ERROR:MAX30105 initialization failed");
  }

  emitSystemReady();
}

void loop() {
  while (Serial.available() > 0) {
    char incoming = (char)Serial.read();

    if (incoming == '\r') continue;

    if (incoming == '\n') {
      if (commandTooLong) {
        Serial.println("ERROR:Command too long");
      } else if (commandLength > 0) {
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
      } else {
        commandTooLong = true;
      }
    }
  }

  if (!max30105SensorReady) {
    return;
  }

  unsigned long now = millis();

  // Always sample lightly so live IR/red updates even before MEASURE_*
  if (now - lastMaxPoll >= MAX_POLL_INTERVAL) {
    lastMaxPoll = now;
    processMax30105Samples();
  }

  if (maxMeasurementRequested) {
    unsigned long maxElapsed = now - maxMeasurementStartTime;

    if (maxElapsed > MAX_MEASUREMENT_DURATION) {
      emitMax30105Results();
      maxMeasurementRequested = false;
    } else {
      bool hasStableHrSpo2 =
        avgBpm > 0 && spO2 > 0 && validBeats >= RATE_SIZE;
      bool hasResp = avgRespRate > 0;

      if (maxElapsed >= 12000UL && hasStableHrSpo2 &&
          (!maxMeasurementRequiresResp || hasResp)) {
        emitMax30105Results();
        maxMeasurementRequested = false;
      }
    }
  }

  if (liveDisplay && (now - lastLivePrint >= LIVE_PRINT_INTERVAL_MS)) {
    lastLivePrint = now;
    printLiveReading();
  }
}
