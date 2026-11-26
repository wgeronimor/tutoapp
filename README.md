# Tuto · Tu francés, cada día

Tuto te acompaña en el aprendizaje del francés con sesiones guiadas, práctica de los temas que elijas y repasos basados en tu historial. Puedes leer, escuchar, escribir y grabar tu voz, conservando tus intentos para ver cómo avanzas.

La versión actual es **0.1.34**, para uso personal en un **Mac con Apple Silicon**. Las funciones de inteligencia artificial se ejecutan en el Mac.

## Qué necesitas instalar

La primera instalación se prepara una sola vez. Necesitas:

- **Python 3.13 y uv**, para instalar y ejecutar la aplicación.
- **Node.js 22.12 o posterior y pnpm 11.25.0**, para preparar la interfaz.
- **PostgreSQL 17**, la versión utilizada para guardar el progreso.
- **Ollama**, para generar prácticas y comentarios.
- **FFmpeg** y los modelos de voz, para escuchar referencias y transcribir grabaciones.

Sigue la [guía de instalación](INSTALACION.md) para preparar las herramientas, la base de datos y los modelos. Necesitarás internet para las descargas iniciales. Todavía no hay un instalador que complete todos esos pasos automáticamente.

Si ya utilizas Tuto en este Mac, puedes pasar directamente a la apertura de la aplicación.

## Cómo abrir Tuto

Haz doble clic en **Abrir Tuto.command**, dentro de la carpeta del proyecto. El acceso directo inicia la aplicación y abre el navegador.

También puedes iniciarla desde una terminal, situada en esa carpeta:

```sh
pnpm start
```

Si ya está funcionando, abre [Tuto en tu Mac](http://127.0.0.1:8765).

Para las funciones de generación y revisión, mantén Ollama abierto. PostgreSQL también debe estar en funcionamiento. Cuando grabes por primera vez, permite que el navegador use el micrófono.

## Tus primeros pasos

1. En **Configuración**, indica tu fecha de inicio, unidad actual y meta personal.
2. Abre **Hoy** para comenzar la sesión del día, o **Mi programa** para elegir otra.
3. En cada actividad, sigue la consigna y responde leyendo, escuchando, escribiendo o grabando tu voz.
4. Guarda el intento que quieras conservar y consulta su resultado.
5. Vuelve a **Frases y repasos** para reforzar lo pendiente y consulta **Mi progreso** para ver tu avance.

## Qué puedes hacer

- **Seguir un programa guiado.** La entrega actual incluye las primeras cuatro semanas de actividades. El programa general se ampliará progresivamente.
- **Practicar un tema propio.** Escribe una situación, revisa el contenido propuesto y pide cambios antes de comenzar.
- **Elegir cómo practicar.** Usa sesiones fijas o práctica continua, con tantas rondas como quieras. Puedes trabajar números, meses, días y otras expresiones.
- **Escuchar y hablar.** Reproduce la referencia, consulta su guía de pronunciación y graba tu respuesta. Puedes escuchar y repetir una toma antes de guardarla.
- **Prepararte para clase.** En **Mis clases**, indica la unidad y las páginas que trabajarás. Los PDF del curso se aportan por separado; no están incluidos en el repositorio.
- **Revisar tu historial.** Consulta intentos, respuestas, grabaciones y comentarios disponibles. Puedes fijar hasta diez prácticas, ordenarlas u ocultarlas del listado y volver a mostrarlas después.
- **Conservar tu progreso.** Los repasos y el historial se mantienen al cerrar y volver a abrir la aplicación.

## Grabaciones y resultados

Antes de guardar puedes descartar o repetir una grabación. En práctica continua de habla, **Reintentar** mantiene la misma expresión y **Continuar** guarda la toma elegida y pasa a la siguiente.

Las opciones de transcripción, validación y revisión automáticas permiten adaptar el ritmo de práctica. La transcripción reconocida es de solo lectura. Los porcentajes indican aciertos en la actividad; no son una calificación acústica de pronunciación ni un resultado oficial de TCF Canada.

Los intentos guardados son definitivos: no se pueden editar ni eliminar. Puedes ocultar una práctica sin perder su historial. Solo pueden eliminarse las propuestas que nunca se iniciaron.

## Guardar una copia de tus datos

En **Configuración → Exportar mis datos**, descarga una copia de tu progreso y de los audios asociados. Guárdala fuera de la carpeta de la aplicación.

Los PDF del curso y los modelos descargados se conservan por separado. La [guía de instalación](INSTALACION.md#recuperar-una-copia) explica cómo recuperar una exportación.

## Si algo no funciona

- **La app no abre:** comprueba que completaste la instalación y que PostgreSQL está activo; vuelve a ejecutar **Abrir Tuto.command**.
- **No se genera una práctica o un comentario:** comprueba que Ollama esté abierto y que los modelos estén preparados. La primera solicitud puede tardar mientras se cargan.
- **No puedes grabar:** revisa el permiso del micrófono en el navegador.
- **No aparece una transcripción:** revisa el mensaje de la actividad, escucha tu toma y vuelve a grabar si hace falta.
- **No abre un PDF:** comprueba que los archivos del curso estén en la ubicación indicada en la guía de instalación.
