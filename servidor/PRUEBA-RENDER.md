# Servidor de prueba en Render (gratis)

Para probar el pase de fichas a otro sistema sin instalar nada. **Los datos se borran** cuando el servidor se duerme (15 minutos sin uso) o se reinicia: es solo para probar. No cargar datos reales de otras personas.

1. Entrar a https://render.com y crear la cuenta con **GitHub**.
2. **New → Blueprint**, elegir el repositorio `entrelazados-con-el-dni-scaner`. Render lee el archivo `render.yaml`.
3. Completar las dos claves que pide:
   - `ADMIN_CLAVE`: la contraseña del usuario `prueba` (mínimo 10 caracteres).
   - `SISTEMA_CLAVE`: la clave del "otro sistema" de prueba (mínimo 16 caracteres).
4. **Apply** y esperar a que diga *Live*. La dirección queda como `https://registro-dni-prueba.onrender.com` (puede variar).
5. En el celular abrir **la dirección de Render** (no la de GitHub) → **Ajustes → Conectar a un servidor**: dirección vacía, usuario `prueba` y la `ADMIN_CLAVE` → **Entrar**.
   Si usás la app desde GitHub Pages, en *Dirección del servidor* escribí la dirección de Render.
6. Escanear un DNI y **Guardar en el Registro**.
7. En otra pestaña o en la compu abrir `https://<la dirección>/otro-sistema.html`, poner la `SISTEMA_CLAVE` y el DNI → **Buscar**: aparecen los datos y las fotos que llegaron del Registro.

Si el servidor estaba dormido, la primera vez tarda alrededor de un minuto en abrir.
