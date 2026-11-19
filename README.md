# SimpleLife PWA — primera interfaz conectada

**Your Life. Your System. Your Intelligence.**

Esta es la primera interfaz de desarrollo sobre el proyecto Supabase `Simplelife_dev`. Está orientada a una experiencia calmada, compacta y móvil.

## Incluye

- Registro e inicio de sesión con Supabase Auth.
- Creación del perfil personal y preferencias (`America/Havana`) después de autenticar.
- Identificadores UUIDv7 generados en el cliente.
- Pantalla Hoy con tareas abiertas y tareas con fecha de hoy.
- Inbox que conserva la captura original y sus fragmentos, con búsqueda, revisión, archivo y restauración manual.
- Áreas de vida, metas y submetas.
- Proyectos con búsqueda por nombre/propósito, filtros por estado y archivo, ordenación, edición de datos/fechas/estado, archivo/restauración reversible y detalle de tareas vinculadas.
- Tareas con relación opcional a proyectos, edición, reapertura, búsqueda, filtros por estado/prioridad y ordenación.
- Notas, ideas y listas con elementos marcables.
- PWA instalable con caché limitada al shell público; las respuestas autenticadas y los datos personales no se cachean.

## Ejecutar en Windows

1. Extrae la carpeta.
2. Abre `Start-SimpleLife.ps1` con PowerShell. El script crea `.env.local` desde `.env.example`, instala dependencias si faltan y arranca Vite.
3. Abre `http://localhost:5173` en el navegador.

También puedes ejecutarlo desde una terminal en esta carpeta:

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Necesita Node.js 22.12 o posterior para Vite 8.3.

## Pruebas y build

```bash
npm ci
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Playwright comprueba los formularios de acceso/registro, el layout móvil a 390px y los flujos de tareas, Inbox y gestión de proyectos usando Auth/PostgREST simulados. Esos mocks verifican el comportamiento del cliente, pero no equivalen a una sesión real ni escriben en Supabase. La CI ejecuta las pruebas y el build en GitHub Actions.

## Conexión

`.env.example` contiene únicamente el URL del proyecto y la clave pública `sb_publishable_...`. No contiene una `service_role` key ni contraseñas. La clave pública está diseñada para estar en el navegador; la seguridad depende de RLS y los privilegios de la base de datos.

Proyecto: `iybnjrnysiikbtokyshg`  
URL: `https://iybnjrnysiikbtokyshg.supabase.co`

## Límites honestos de esta versión

- El Inbox todavía no clasifica con IA: captura, conserva el original y crea un fragmento inicial.
- No están implementados eventos, recurrencias, hábitos, espacios compartidos, permisos de equipo, integraciones con ARIA ni automatizaciones.
- No hay almacenamiento offline de datos personales. El service worker guarda solo el shell público de la aplicación.
- Esta es una versión local de desarrollo; no está desplegada públicamente ni es producción.
- Un E2E con una cuenta Supabase real y validación en dispositivo físico siguen pendientes. Las pruebas RLS transaccionales están documentadas en `docs/rls-smoke-results.md`.
