# Instalar y abrir Tuto en un Mac

Esta guía prepara una copia nueva del proyecto para uso personal en un Mac con Apple Silicon. La configuración de referencia se ha utilizado en un Mac con 64 GB de memoria; esa cifra no representa un mínimo de memoria validado para otros equipos.

La preparación es manual. Si Tuto ya funciona en este Mac, no necesitas volver a crear su base de datos ni repetir la instalación para abrirlo.

## 1. Preparar las herramientas

Instala estas herramientas y comprueba que sus comandos estén disponibles en Terminal:

| Herramienta | Versión o configuración de referencia |
| --- | --- |
| Python | 3.13 |
| uv | Gestor de instalación de Python y sus dependencias |
| Node.js | 22.12 o posterior |
| pnpm | 11.25.0, indicada en `package.json` |
| PostgreSQL | 17; el Mac de referencia utiliza 17.8 |
| Ollama | Servicio local y modelo `qwen3:8b` |
| FFmpeg | Comando `ffmpeg` disponible para procesar grabaciones |

PostgreSQL debe incluir los comandos `psql`, `createdb`, `pg_dump` y `pg_restore` en el PATH de la terminal y del acceso directo. Si empleas una instalación de Homebrew fuera del PATH habitual, añade su carpeta `bin` a tu configuración de terminal antes de continuar.

Abre Ollama y descarga una vez el modelo de texto:

```sh
ollama pull qwen3:8b
```

## 2. Preparar la aplicación

Abre Terminal en la carpeta del proyecto. Todos los comandos siguientes se ejecutan desde esa carpeta.

Instala las dependencias guardadas en los archivos de versiones del proyecto:

```sh
uv sync --frozen
pnpm --dir frontend install --frozen-lockfile
```

Prepara la configuración local. Este comando conserva un `.env` que ya exista:

```sh
test -f .env || cp .env.example .env
```

La plantilla utiliza PostgreSQL en `127.0.0.1:5432`, usuario `postgres`, contraseña vacía y base `tuto_db`; Ollama en `http://127.0.0.1:11434`. Si tu instalación utiliza otros datos, edita `.env` para que coincidan con ella.

## 3. Preparar PostgreSQL

Inicia PostgreSQL. Si instalaste la versión 17 mediante Homebrew, puedes hacerlo con:

```sh
brew services start postgresql@17
```

La configuración de referencia necesita que exista el rol `postgres`. En una instalación nueva de Homebrew, si ese rol todavía no existe, el usuario administrador local puede crearlo con:

```sh
createuser --createdb postgres
```

Solo para una instalación nueva, crea la base de datos:

```sh
createdb -h 127.0.0.1 -U postgres tuto_db
```

Si `tuto_db` ya existe y contiene tu progreso, conserva esa base. A continuación, aplica la preparación de tablas del proyecto:

```sh
.venv/bin/alembic upgrade head
```

## 4. Preparar la voz

El audio utiliza un entorno separado. Créalo e instala las dependencias de la configuración probada:

```sh
uv venv --python 3.13 local-model-tests/.venv
uv pip install --python local-model-tests/.venv/bin/python -r local-model-tests/requirements-installed.txt
```

Descarga los tres modelos de voz de la configuración actual y registra sus ubicaciones en este Mac. Esto requiere internet y espacio para los modelos; no descarga grabaciones del estudiante.

```sh
local-model-tests/.venv/bin/python - <<'PY'
import json
from pathlib import Path
from huggingface_hub import snapshot_download

config = Path("config/audio-models.json")
models = json.loads(config.read_text())
for model in models:
    model["path"] = snapshot_download(
        repo_id=model["repo_id"],
        revision=model["revision"],
        allow_patterns=model.get("allow_patterns"),
    )
config.write_text(json.dumps(models, ensure_ascii=False, indent=2) + "\n")
PY
```

Se preparan Whisper large-v3-turbo, Qwen3-ASR 1,7B y Kokoro. No basta con ejecutar el antiguo `local-model-tests/download_audio_models.py`: ese archivo conserva la descarga de la prueba inicial con Qwen3-ASR 0,6B.

La configuración `config/audio-models.json` contiene rutas que dependen del Mac. El paso anterior las adapta a tu equipo. Una vez descargados, el audio y el reconocimiento se procesan localmente.

## 5. Añadir los PDF del curso, si los vas a utilizar

Los PDF no se incluyen en Git. Para abrirlos desde **Mis clases** y preparar actividades a partir de sus páginas, conserva los archivos originales en:

```text
pdf_classes/french-class-A1-level/
```

Mantén sus nombres originales: la app identifica cada unidad mediante el número de página y `Unit`. Por ejemplo, la unidad 1 utiliza un archivo cuyo nombre comienza por `17_Unit_01_`.

El programa propio y la práctica por temas no requieren estos PDF. Las funciones que abren o leen las páginas de clase sí los necesitan.

## 6. Abrir Tuto

Prepara la interfaz una vez:

```sh
pnpm build
```

Mantén PostgreSQL y Ollama activos. Haz doble clic en **Abrir Tuto.command**, o utiliza:

```sh
pnpm start
```

Se abrirá [Tuto en tu Mac](http://127.0.0.1:8765). Permite el acceso al micrófono cuando quieras grabar.

Si cambias el código de la interfaz en una actualización, vuelve a ejecutar `pnpm build`: el acceso directo solo la prepara automáticamente cuando todavía no existe una interfaz compilada.

## Recuperar una copia

Desde **Configuración → Exportar mis datos** puedes obtener un archivo `.tar.gz` con tu progreso y audios. Para recuperarlo, elige una base de datos y una carpeta de audios nuevas:

```sh
.venv/bin/python scripts/restore.py /ruta/tuto-export.tar.gz --database tuto_recuperado --media /ruta/nueva-media
```

Este paso requiere que el usuario administrador local pueda crear bases y que exista el rol `postgres`. La recuperación rechaza una carpeta existente y no reemplaza una base que ya exista.

Después indica en `.env` la base recuperada mediante `DATABASE_URL` y la carpeta recuperada mediante `DATA_DIR`. Reinicia la aplicación para utilizar esas ubicaciones. Los PDF y modelos se aportan por separado; no forman parte de la exportación.
