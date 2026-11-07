# Servidor del Registro DNI

Guarda en un solo lugar las fichas de las personas (una por DNI), las fotos del documento y los trámites, con usuarios, roles y registro de actividad. La app lo usa en el modo **Servidor de la institución**, y los otros sistemas autorizados lo consultan por número de DNI.

Lo tiene que instalar y administrar el área de sistemas, en un equipo de la institución. No usar con datos reales hasta que la base esté autorizada (Ley 25.326: disposición de creación e inscripción ante la Agencia de Acceso a la Información Pública).

## Requisitos

- Node.js 22.13 o más nuevo. No hace falta instalar nada más: la base es SQLite y viene con Node.
- Un certificado HTTPS delante del servidor (por ejemplo, con el proxy web de la institución). Sin HTTPS el celular no deja usar la cámara ni mandar datos de forma segura.

## Primer arranque

```bash
# 1. Clave para cifrar las fotos en el disco (guardarla en un lugar seguro: sin ella las fotos no se pueden leer)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. Primer usuario (responsable). Pide la contraseña.
node servidor/usuarios.js agregar jefe responsable "Nombre y Apellido"

# 3. Arrancar (la app y la API desde el mismo servidor)
CLAVE_DATOS=<la clave del paso 1> SERVIR_APP=1 PUERTO=8080 node servidor/servidor.js
```

Con `SERVIR_APP=1` la app queda en `https://<servidor>/` y en Ajustes se entra dejando vacía la dirección del servidor. Si la app se publica en otro lado (por ejemplo, GitHub Pages), agregar su origen: `ORIGENES=https://usuario.github.io`.

## Usuarios y roles

```bash
node servidor/usuarios.js agregar <usuario> <rol> "<Nombre>"   # rol: responsable, carga o consulta
node servidor/usuarios.js clave <usuario>                     # cambiar la contraseña
node servidor/usuarios.js baja <usuario>                      # desactivar
node servidor/usuarios.js lista
node servidor/usuarios.js clave-sistema "Sistema de certificados"   # clave de solo lectura para otro sistema
```

| Rol | Puede |
| --- | --- |
| responsable | Todo, ver el registro de actividad y borrar fichas |
| carga | Cargar personas, fotos y trámites; consultar |
| consulta | Solo consultar |
| sistema (clave) | Solo consultar, desde otro sistema |

## API (para los otros sistemas)

Todas las direcciones empiezan con `/api/v1` y llevan `Authorization: Bearer <token o clave de sistema>`.

| Método y dirección | Qué hace |
| --- | --- |
| `POST /sesion` `{usuario, clave}` | Entra; devuelve `token` (dura 12 h) |
| `GET /personas?q=texto` | Busca por DNI, apellido o nombre |
| `GET /personas/{dni}` | Ficha completa con fotos y trámites |
| `PUT /personas/{dni}` | Crea o actualiza los datos (rol carga) |
| `PUT /personas/{dni}/fotos/{frente\|reverso}` | Sube la foto (JPEG o PNG, cuerpo binario) |
| `GET /fotos/{id}` | Devuelve la foto |
| `GET /tramites?dni=&estado=` | Lista trámites |
| `POST /tramites` `{dni, tipo, observaciones}` | Inicia un trámite |
| `PATCH /tramites/{id}` `{estado}` | Cambia el estado |
| `GET /auditoria?dni=` | Registro de actividad (rol responsable) |
| `DELETE /personas/{dni}` | Borra la ficha, sus fotos y trámites (rol responsable) |

## Seguridad

- Contraseñas guardadas con scrypt; sesiones con token aleatorio guardado como hash.
- Fotos cifradas con AES-256-GCM si se define `CLAVE_DATOS`.
- Registro de actividad: cada entrada, búsqueda, consulta, carga, foto vista y cambio queda con agente, hora e IP. La base no deja modificarlo ni borrarlo.
- 10 intentos fallidos de entrada desde una IP la bloquean 15 minutos.
- Respaldo: copiar la carpeta `servidor/datos` todos los días a otro equipo (con el servidor detenido o usando `sqlite3 .backup`).
