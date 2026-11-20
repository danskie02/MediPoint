#include <Wire.h>
#include <Adafruit_MLX90614.h>
#include <math.h>
#include <string.h>

Adafruit_MLX90614 mlx;

bool temperatureSensorReady = false;

char commandBuffer[64];
size_t commandLength = 0;
bool commandTooLong = false;

// Live Serial Monitor readout
bool liveDisplay = true;
unsigned long lastLivePrint = 0;
const unsigned long LIVE_PRINT_INTERVAL_MS = 500;

void emitSystemReady() {
  Serial.println("STATUS:System ready");
  Serial.print("STATUS:Sensors temp=");
  Serial.println(temperatureSensorReady ? "ok" : "fail");
  Serial.println("STATUS:Live display ON (send LIVE_OFF / LIVE_ON)");
}

bool readTemperature(float& objectC, float& ambientC) {
  objectC = mlx.readObjectTempC();
  ambientC = mlx.readAmbientTempC();

  if (isnan(objectC) || isinf(objectC) ||
      isnan(ambientC) || isinf(ambientC)) {
    return false;
  }

  return true;
}

void printLiveReading() {
  if (!temperatureSensorReady) {
    Serial.println("TEMP_LIVE:ERROR not ready");
    return;
  }

  float tempObj = 0;
  float tempAmb = 0;

  if (!readTemperature(tempObj, tempAmb)) {
    Serial.println("TEMP_LIVE:ERROR invalid reading");
    return;
  }

  Serial.print("TEMP_LIVE:object=");
  Serial.print(tempObj, 1);
  Serial.print("C ambient=");
  Serial.print(tempAmb, 1);
  Serial.println("C");
}

void handleCommand(const char* command) {
  Serial.print("DEBUG:Received command: [");
  Serial.print(command);
  Serial.println("]");

  if (strcmp(command, "MEASURE_TEMPERATURE") == 0) {
    if (!temperatureSensorReady) {
      Serial.println("STATUS:Retrying temperature sensor initialization...");
      temperatureSensorReady = mlx.begin();

      if (!temperatureSensorReady) {
        Serial.println("ERROR:MLX90614 initialization failed");
        return;
      }
    }

    float tempObj = 0;
    float tempAmb = 0;

    if (!readTemperature(tempObj, tempAmb)) {
      Serial.println("ERROR:Temperature reading invalid");
      return;
    }

    Serial.print("DEBUG:Raw Ambient Temp (C): ");
    Serial.println(tempAmb);

    Serial.print("DEBUG:Raw Object Temp (C): ");
    Serial.println(tempObj);

    Serial.print("TEMPERATURE_RESULT:");
    Serial.println(tempObj, 1);
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

  Wire.begin();

  Serial.println("STATUS:Initializing temperature sensor...");

  temperatureSensorReady = mlx.begin();

  if (!temperatureSensorReady) {
    Serial.println("ERROR:MLX90614 initialization failed");
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
