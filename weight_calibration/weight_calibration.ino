/*
  HX711 weight calibration sketch

  How to use:
  1. Upload this sketch and open Serial Monitor at 9600 baud (Newline).
  2. Wait for tare (scale must be empty).
  3. Place a known weight on the scale.
  4. Type the known weight in grams (e.g. 500) and press Enter.
  5. Copy the printed calibrationFactor into weight_only.ino.
  6. Re-upload weight_only.ino.

  Optional Serial commands after calibration:
    TARE          - re-tare with empty scale
    FACTOR <n>    - try a different factor live (e.g. FACTOR 23018)
    WEIGHT <n>    - recalibrate using a new known weight in grams
*/

#include "HX711.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

HX711 scale;

const int DT_PIN = 3;
const int SCK_PIN = 2;

// Start uncalibrated (raw units). Updated after you enter a known weight.
float calibrationFactor = 1.0;

char commandBuffer[64];
size_t commandLength = 0;
bool commandTooLong = false;

unsigned long lastPrint = 0;
const unsigned long PRINT_INTERVAL_MS = 1000;

bool waitingForKnownWeight = true;

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

void printHelp() {
  Serial.println();
  Serial.println("=== HX711 Calibration ===");
  Serial.println("1. Keep the scale empty until tare finishes.");
  Serial.println("2. Place a known weight on the scale.");
  Serial.println("3. Type that weight in grams and press Enter (e.g. 500).");
  Serial.println();
  Serial.println("Commands:");
  Serial.println("  <grams>       calibrate with that known weight");
  Serial.println("  TARE          tare empty scale");
  Serial.println("  FACTOR <n>    set calibration factor manually");
  Serial.println("  WEIGHT <n>    same as entering grams");
  Serial.println("  HELP          show this help");
  Serial.println();
}

void printReading() {
  if (!waitForHx711(500)) {
    // Skip quietly; sensor often needs a moment between averaged reads.
    return;
  }

  // One averaged sample for both RAW and WEIGHT so they always match.
  long raw = scale.read_average(10);
  float net = (float)raw - (float)scale.get_offset();
  float units = (calibrationFactor == 0.0f) ? 0.0f : (net / calibrationFactor);

  Serial.print("RAW:");
  Serial.print(raw);
  Serial.print("  NET:");
  Serial.print(net, 1);
  Serial.print("  WEIGHT:");
  Serial.print(units, 2);
  Serial.print(" g  FACTOR:");
  Serial.println(calibrationFactor, 4);
}

void applyCalibration(float knownWeightGrams) {
  if (knownWeightGrams <= 0.0f) {
    Serial.println("ERROR:Known weight must be > 0");
    return;
  }

  if (!waitForHx711(1000)) {
    Serial.println("ERROR:HX711 not ready. Check wiring (DT=3, SCK=2) and power.");
    return;
  }

  // Measure with scale=1 so get_units() returns raw counts above tare.
  scale.set_scale(1.0f);
  delay(50);

  if (!waitForHx711(1000)) {
    Serial.println("ERROR:HX711 not ready during calibration read");
    scale.set_scale(calibrationFactor);
    return;
  }

  float rawUnits = scale.get_units(20);

  if (fabs(rawUnits) < 100.0f) {
    Serial.println("ERROR:Reading too small. Is the known weight on the scale?");
    Serial.print("STATUS:Raw units seen: ");
    Serial.println(rawUnits, 2);
    scale.set_scale(calibrationFactor);
    return;
  }

  calibrationFactor = rawUnits / knownWeightGrams;
  scale.set_scale(calibrationFactor);

  Serial.println();
  Serial.println("STATUS:Calibration complete");
  Serial.print("STATUS:Known weight (g): ");
  Serial.println(knownWeightGrams, 2);
  Serial.print("STATUS:Raw units: ");
  Serial.println(rawUnits, 2);
  Serial.print("calibrationFactor = ");
  Serial.print(calibrationFactor, 4);
  Serial.println(";");
  if (calibrationFactor < 0.0f) {
    Serial.println("STATUS:Negative factor is OK (load cell wired / mounted orientation).");
  }
  Serial.println("STATUS:Paste that value into weight_only.ino");
  Serial.println("STATUS:Empty scale should read ~0 g; known weight should match.");
  Serial.println();

  waitingForKnownWeight = false;
  printReading();
}

bool parseLeadingFloat(const char* text, float* outValue) {
  while (*text == ' ') {
    text++;
  }
  if (*text == '\0') {
    return false;
  }

  bool hasDigit = false;
  for (const char* p = text; *p != '\0'; p++) {
    if (*p >= '0' && *p <= '9') {
      hasDigit = true;
      break;
    }
  }
  if (!hasDigit) {
    return false;
  }

  *outValue = (float)atof(text);
  return true;
}

bool parsePrefixedFloat(const char* command, const char* prefix, float* outValue) {
  size_t prefixLen = strlen(prefix);
  if (strncmp(command, prefix, prefixLen) != 0) {
    return false;
  }
  return parseLeadingFloat(command + prefixLen, outValue);
}

void handleCommand(const char* command) {
  if (strcmp(command, "HELP") == 0) {
    printHelp();
    return;
  }

  if (strcmp(command, "TARE") == 0) {
    if (!waitForHx711(1000)) {
      Serial.println("ERROR:HX711 not ready");
      return;
    }
    scale.tare(20);
    Serial.println("STATUS:Scale tared. Place known weight, then enter grams.");
    waitingForKnownWeight = true;
    return;
  }

  float value = 0.0f;

  if (parsePrefixedFloat(command, "FACTOR ", &value)) {
    if (value == 0.0f) {
      Serial.println("ERROR:Factor cannot be 0");
      return;
    }
    calibrationFactor = value;
    scale.set_scale(calibrationFactor);
    waitingForKnownWeight = false;
    Serial.print("STATUS:calibrationFactor set to ");
    Serial.println(calibrationFactor, 4);
    printReading();
    return;
  }

  if (parsePrefixedFloat(command, "WEIGHT ", &value) || parseLeadingFloat(command, &value)) {
    applyCalibration(value);
    return;
  }

  Serial.println("ERROR:Unknown command. Send HELP.");
}

void setup() {
  Serial.begin(9600);
  delay(300);

  Serial.println("STATUS:Initializing HX711 for calibration...");
  scale.begin(DT_PIN, SCK_PIN);
  delay(500);

  if (!waitForHx711(2000)) {
    Serial.println("ERROR:HX711 initialization failed. Check DT=3, SCK=2 wiring.");
    return;
  }

  scale.set_scale(1.0f);
  scale.tare(20);

  Serial.println("STATUS:Scale tared (empty).");
  printHelp();
  Serial.println("STATUS:Waiting for known weight value in grams...");
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

  if (!waitingForKnownWeight && (millis() - lastPrint >= PRINT_INTERVAL_MS)) {
    lastPrint = millis();
    printReading();
  }
}
