# SimpleLife PWA — primera interfaz conectada

**Your Life. Your System. Your Intelligence.**

Esta es la primera interfaz de desarrollo sobre el proyecto Supabase `Simplelife_dev`. Está orientada a una experiencia calmada, compacta y móvil.

## Incluye
- Registro e inicio de sesión con Supabase Auth.
- Perfil personal y preferencias (`America/Havana`).
- Identificadores UUIDv7 generados en el cliente.
- Hoy, Inbox, áreas, metas/submetas, proyectos, tareas, notas, ideas y listas.
- PWA instalable con caché limitada al shell público; nunca cachea datos autenticados.

## Ejecutar en Windows
1. Extrae la carpeta.
2. Abre `Start-SimpleLife.ps1` con PowerShell.
3. Abre `http://localhost:5173`.

También puedes ejecutar `Copy-Item .env.example .env.local; npm install; npm run dev`.

Necesita Node.js 22.12 o posterior para Vite 8.

## Seguridad
`.env.example` contiene solo URL del proyecto Supabase y clave pública `sb_publishable_...`. No contiene claves `service_role` ni contraseñas. La seguridad depende de RLS y privilegios de base de datos.

## Límites de esta versión
- El Inbox todavía no clasifica con IA.
- No están implementados eventos, recurrencias, hábitos, espacios compartidos ni integraciones ARIA.
- No hay datos personales offline; el service worker solo guarda el shell público.
- Es una versión local de desarrollo, no desplegada ni producción.
- Las operaciones requieren pruebas negativas adicionales y E2E autenticado.
