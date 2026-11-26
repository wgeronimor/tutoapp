# Muestra para transcripción de palabras cortas

`quiet-dix.wav` es voz sintética francesa creada con Kokoro-82M, voz `ff_siwis`, diciendo «dix». No contiene voz del estudiante. Es PCM16 mono a 16 kHz, con pausas añadidas antes y después y amplitud reducida deliberadamente.

Métricas del archivo: duración 2,075 segundos; RMS total aproximado −41,18 dBFS; RMS de los tramos detectados como voz −35,57 dBFS. La muestra reproduce el caso de voz utilizable que el antiguo umbral de −40 dBFS aplicado a toda la grabación rechazaba. Los recorridos Playwright la usan como entrada de micrófono y comparan el resultado real del reconocedor con el cuadro de solo lectura; no inyectan una transcripción esperada.
