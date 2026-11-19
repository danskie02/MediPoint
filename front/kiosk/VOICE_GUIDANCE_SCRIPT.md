# MediPoint Kiosk Voice Guidance

Recording script aligned with the current kiosk flow. Record each numbered clip as a separate audio file. Text in square brackets is a production note and must not be spoken.

## Recording notes

- Use a calm, clear, welcoming voice. Leave a short pause between instructions.
- Keep each clip self-contained because users can choose measurements in any order.
- The current kiosk does not automatically speak on its welcome screen. It speaks when a measurement dialog opens, while status messages change, and on the summary page.
- The current implementation uses the browser's built-in speech synthesis; it does not yet load recorded audio files. These clips are a content package for a future recorded-audio playback integration.
- The kiosk may show clearly labeled demonstration values when a sensor is unavailable. Keep that disclosure visible on screen; do not mention demo or simulated data in spoken guidance.

## Start and general guidance

### `welcome_get_started`

Welcome to MediPoint. Select Get Started to continue. Please make sure the kiosk equipment is ready before beginning.

### `choose_login_method`

Choose Student or Personnel, then choose ID or QR Code. Select Continue. For ID login, enter your registered full name and Student Number or Employee ID. For QR login, present your MediPoint QR code to the scanner. If you do not have an account, select Create an account or ask clinic staff for help.

### `audio_on`

Audio guidance is on.

### `before_measurements`

Welcome to the MediPoint health check. Please rest for five minutes before taking your measurements. Select a measurement on the screen, follow the instructions, and press Start when you are ready. Complete each measurement you want recorded. When all seven measurements are complete, select View Summary to review your results. These results are for health monitoring and education only. They are not a diagnosis and must not replace advice from a qualified health professional.

## Measurement instructions

### `height_instructions`

Height measurement. Please remove your shoes and stand on the height platform with bare feet. Stand straight with your back toward the sensor, look forward, and keep your feet flat. Remain still while the kiosk measures your height. Press Start when you are ready.

### `weight_instructions`

Weight measurement. Step onto the weight scale and stand in the center. Distribute your weight evenly across both feet, then remain still while the kiosk measures. Press Start when you are ready.

### `heart_rate_instructions`

Heart rate is measured as pulse by the blood pressure monitor. No separate heart rate sensor is needed.

### `oxygen_saturation_instructions`

Oxygen saturation measurement. Place your finger inside the pulse oximeter. Keep your hand relaxed and still while it takes the reading. Press Start when you are ready.

### `respiratory_rate_instructions`

Respiratory rate measurement. Place your finger on the pulse oximeter sensor. Breathe normally and keep your hand steady while the kiosk estimates your breathing rate. Press Start when you are ready.

### `body_temperature_instructions`

Body temperature measurement. Position yourself near the thermometer and use it as directed on the screen. Keep still and leave the device in place until the reading is complete. Press Start when you are ready.

### `blood_pressure_instructions`

Blood pressure and pulse measurement. Place your arm inside the cuff and rest it comfortably. Stay calm and do not talk while the cuff measures. The reading may take up to one or two minutes. Press Start when you are ready.

## Reusable status clips

### `sensor_ready`

The system is ready. Press Start when you are ready to measure.

### `height_measuring`

The height sensor is active. Please stand still while the measurement is taken.

### `weight_measuring`

The weight scale is active. Please stand still while the measurement is taken.

### `finger_sensor_measuring`

The finger sensor is active. Keep your finger and hand steady until the reading is complete.

### `temperature_measuring`

The temperature sensor is active. Please keep still until the reading is complete.

### `blood_pressure_waiting`

The blood pressure monitor is connected. Please remain calm and wait for your blood pressure and pulse reading. This can take up to one or two minutes.

### `measurement_complete`

Measurement complete. Your result is shown on the screen. Review it before continuing.

### `all_measurements_complete`

All measurements are finished. Select View Summary to continue.

### `sensor_unavailable_result_notice`

The sensor did not provide a reading. Please review the displayed result and ask clinic staff if you need help.

### `measurement_retry`

The measurement could not be completed. Please follow the instructions and try again. Ask clinic staff for help if the problem continues.

## Summary page

### `summary_attention`

Some measurements may need attention. Consider repeating the measurement or speaking with clinic personnel. These results do not provide a diagnosis. Review the values and their notes on the screen.

### `summary_no_attention_flagged`

Your completed measurements and their recorded statuses are shown on the screen. These results are for health monitoring and education only, not a diagnosis. Speak with a qualified health professional if you have concerns.

## Dynamic values

The current kiosk can speak changing text such as a measurement name, a measured value, and a sensor connection error. Do not record a clip containing a guessed value. For recorded audio, use `measurement_complete` and keep the actual value visible on screen, or implement a reviewed method for combining fixed recordings with the displayed value. Keep any demonstration-value disclosure visible on screen, not in spoken guidance.

## Current-flow caveats for implementation

- Height and weight are separate selections in the current kiosk; do not record a combined Height and Weight prompt for this screen.
- The summary is reached after all seven selectable actions are complete; the Heart Rate action displays the latest pulse from the blood pressure monitor.
- Oxygen Saturation and Respiratory Rate both use the MAX30105 finger sensor over Arduino serial. One reading can cache the paired vital for the other card.
- Blood pressure waits for a Microlife monitor result and can remain pending for up to two minutes; do not tell users that a simulated blood pressure value is a valid reading.
- Audio guidance can be turned off with the Audio On control. The current toggle announces only “Audio guidance is on” when switched on.