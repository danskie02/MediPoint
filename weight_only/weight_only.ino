#include "HX711.h"
#include <string.h>

HX711 scale;

// HX711 pins
const int DT_PIN = 3;
const int SCK_PIN = 2;

// Adjusted: 2.000 kg known read as 4.967 kg with 8.8760
// → 8.8760 * (4.967 / 2.000) = 22.0435
float calibrationFactor = 22.0435;

bool weightSensorReady = false;

char commandBuffer[64];
size_t commandLength = 0;
bool commandTooLong = false;

// Live Serial Monitor readout
bool liveDisplay = true;
unsigned long lastLivePrint = 0;
// get_units(10) needs ~1s at 10 SPS, so poll slower than the read itself.
const unsigned long LIVE_PRINT_INTERVAL_MS = 1000;

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
  delay(500);

  if (!waitForHx711(2000)) {
    return false;
  }

  scale.set_scale(calibrationFactor);
  scale.tare(10);
  return true;
}

void emitSystemReady() {
  Serial.println("STATUS:System ready");
  Serial.print("STATUS:Sensors weight=");
  Serial.println(weightSensorReady ? "ok" : "fail");
  Serial.println("STATUS:Live display ON (send LIVE_OFF / LIVE_ON)");
}

// Returns weight in kilograms (calibration factor is still based on grams).
float readWeight() {
  float weightKg = scale.get_units(10) / 1000.0f;

  // Soft zero-band (~±0.6 g)
  if (weightKg > -0.0006f && weightKg < 0.0006f) {
    weightKg = 0.0f;
  }

  return weightKg;
}

void printLiveReading() {
  if (!weightSensorReady) {
    Serial.println("WEIGHT_LIVE:ERROR not ready");
    return;
  }

  if (!waitForHx711(500)) {
    // Chip still converting; skip this tick instead of spamming errors.
    return;
  }

  float weight = readWeight();

  Serial.print("WEIGHT_LIVE:");
  Serial.print(weight, 3);
  Serial.println(" kg");
}

void handleCommand(const char* command) {
  Serial.print("DEBUG:Received command: [");
  Serial.print(command);
  Serial.println("]");

  if (strcmp(command, "MEASURE_WEIGHT") == 0) {
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

    float weight = readWeight();
    Serial.print("WEIGHT_RESULT:");
    Serial.print(weight, 3);
    Serial.println(" kg");
  }
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

  Serial.println("STATUS:Initializing weight sensor...");

  weightSensorReady = initWeightSensor();
  if (weightSensorReady) {
    Serial.println("STATUS:Scale tared");
  } else {
    Serial.println("ERROR:HX711 initialization failed");
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

  // Continuous Serial Monitor line
  if (liveDisplay && (millis() - lastLivePrint >= LIVE_PRINT_INTERVAL_MS)) {
    lastLivePrint = millis();
    printLiveReading();
  }
}
