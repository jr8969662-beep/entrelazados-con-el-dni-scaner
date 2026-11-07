# Registro DNI

Registro de personas por DNI: se escanea el DNI (viejo o nuevo), se guardan los datos y las fotos del frente y del reverso en una ficha por persona, y se le suman los trámites que hace (antecedentes, residencia, convivencia, etc.). Otros sistemas autorizados pueden consultar la ficha por número de DNI.

Es un proyecto aparte del [Escáner DNI](https://github.com/jr8969662-beep/escaner-dni-ar): usa el mismo motor de lectura (versión 50), sin tocar aquel.

## Partes

| Carpeta | Qué es |
| --- | --- |
| `index.html`, `js/`, `css/` | La app: el escáner completo (código de barras del DNI viejo, QR y texto del DNI nuevo, reverso con domicilio y CUIL, lectura nativa en la APK) más el Registro (`js/registro/`). |
| `servidor/` | El servidor de la institución: base de datos, fotos cifradas, usuarios, roles, registro de actividad y la API para otros sistemas. Ver `servidor/LEEME.md`. |

## Cómo se usa

1. Escanear el DNI como en el Escáner DNI.
2. En la ficha aparece **Guardar en el Registro**: si la persona ya estaba, lo avisa y suma el trámite a su ficha.
3. El botón **Registro** (arriba) muestra las personas, los trámites, el registro de actividad, cómo lo consultan otros sistemas y los ajustes.

En **Ajustes** se elige dónde se guarda:
- **En este equipo**: para probar. Las fichas quedan solo en ese celular o navegador.
- **Servidor de la institución**: con usuario y contraseña, todas las fichas en un solo lugar.

## Antes de usarlo con datos reales

Una base con datos y fotos de DNI de terceros tiene que ser de la institución y cumplir la Ley 25.326: disposición de creación de la base, inscripción ante la Agencia de Acceso a la Información Pública, informar a cada persona, servidor propio con HTTPS y respaldo. Los antecedentes penales los tratan solo las autoridades competentes: el Registro guarda el trámite, no el resultado.
