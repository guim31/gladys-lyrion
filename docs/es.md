# Lyrion Music Server

Controle desde Gladys los reproductores de su **Lyrion Music Server** (antes Logitech Media Server,
LMS): Squeezebox Touch, Radio, Boom, Duet, piCorePlayer, squeezelite y cualquier reproductor
compatible. Gladys sigue lo que suena en cada reproductor, lo controla, reproduce sus favoritos de
Lyrion, pausa toda la casa y reproduce anuncios que devuelven la música donde estaba.

Probada con Lyrion Music Server 9.1 y reproductores squeezelite, no con una Squeezebox física: sus
comentarios son bienvenidos. Esta integración no está afiliada al proyecto Lyrion ni a Logitech.

## Requisitos

- Gladys Assistant 5.1 o posterior.
- Un Lyrion Music Server accesible desde Gladys en la red local: puerto web **9000** y, para
  actualizaciones inmediatas, puerto CLI **9090** (abiertos por defecto). Logitech Media Server 8
  tiene la misma API y también debería funcionar.
- No hay nada que instalar en los reproductores.

## Configuración

1. En **Integraciones**, abra **Lyrion Music Server** y escriba la **dirección del servidor**
   (dirección IP o nombre de host, p. ej. `192.168.1.20`). Cambie el **puerto web** si no es 9000.
2. Si la protección con contraseña está activa en Lyrion (**Ajustes → Avanzado → Seguridad**),
   escriba el **nombre de usuario** y la **contraseña**.
3. **Puerto CLI**: Lyrion anuncia por él cada cambio (9090 por defecto), así Gladys ve al instante
   una nueva canción o un cambio de volumen. `0` lo desactiva: Gladys lee entonces los reproductores
   cada 5 segundos.
4. **Idioma de los nombres de funciones**: francés por defecto. También se usa en los mensajes de
   error de las acciones de escena.
5. Abra la pestaña **Descubrir**: allí están todos los reproductores del servidor. Pulse **Añadir a
   Gladys**.

## Dispositivos

Un dispositivo por reproductor, identificado por su identificador de reproductor de Lyrion (la
dirección MAC de una Squeezebox o de squeezelite): cambiar el nombre de un reproductor o su
dirección IP conserva el mismo dispositivo.

| Función                | Qué hace                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Encendido              | Enciende o apaga el reproductor (el botón de encendido de Lyrion).                                 |
| Estado de reproducción | 1 mientras el reproductor suena, 0 si no (pausa, parada, apagado).                                 |
| Reproducir, Pausa      | Reproduce o reanuda, pausa.                                                                        |
| Detener                | Detiene la reproducción.                                                                           |
| Anterior, Siguiente    | Canción anterior o siguiente de la cola.                                                           |
| Volumen                | De 0 a 100.                                                                                        |
| Silencio               | Silencia o restablece el sonido (cada pulsación alterna).                                          |
| Título, Artista        | Lo que suena; en una radio, la canción que anuncia si lo hace, si no la emisora.                   |
| Anuncio                | Destino de la acción de escena **Hablar en un altavoz** de Gladys: habla y luego vuelve la música. |

Los botones de reproducción y el volumen pertenecen a la categoría **Música** de Gladys: la caja
**Música** del panel los controla. El widget **Reproductores Lyrion** de abajo muestra el resto.

## Widget del panel

**Reproductores Lyrion** tiene un ajuste opcional, un **reproductor**:

- **Vacío**: todos los reproductores del servidor en una lista, con lo que suena y su estado, y un
  botón **Pausar todo** mientras algo suena.
- **Un reproductor**: la carátula (cuando Lyrion tiene una), la canción, el artista y el álbum, el
  estado, el volumen, el grupo con el que suena y cuatro botones: reproducir/pausa, siguiente,
  volumen − y volumen +. Un reproductor apagado ofrece **Encender**.

## Disparadores de escena

| Disparador            | Cuándo                                                                   | Filtros                                           | Variables                                      |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------- |
| Reproducción iniciada | Un reproductor empieza o reanuda la reproducción.                        | Reproductor                                       | Nombre del reproductor, título, artista, álbum |
| Reproducción detenida | Un reproductor deja de sonar.                                            | Reproductor, motivo (en pausa, detenido, apagado) | Las mismas, más el motivo (clave)              |
| Canción cambiada      | Un reproductor pasa a otra canción, o una radio anuncia un título nuevo. | Reproductor                                       | Nombre del reproductor, título, artista, álbum |

Los disparadores reflejan lo que hacen de verdad los reproductores, sea quien sea quien lo pidió:
una escena que vuelve a lanzar la música en «Reproducción detenida» entraría en bucle. No se dispara
nada por lo que ya sonaba al iniciarse la integración, ni durante un anuncio.

## Acciones de escena

| Acción                             | Campos                                                         | Resultado                                      |
| ---------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| Reproducir un favorito de Lyrion   | Reproductor, favorito (nombre o posición: `FIP`, `1`)          | Enciende el reproductor y lo reproduce.        |
| Ajustar el volumen                 | Reproductor (vacío: todos), volumen                            |                                                |
| Pausar todos los reproductores     | —                                                              | Salida: el número de reproductores pausados.   |
| Reproducir un anuncio              | Reproductor, dirección de audio (http/https), volumen opcional | Lo reproduce y luego devuelve la música.       |
| Unirse a un grupo de reproductores | Reproductor, reproductor al que unirse                         | Ambos suenan a la vez (sincronización Lyrion). |
| Salir del grupo                    | Reproductor                                                    | El reproductor vuelve a sonar solo.            |

Un favorito se busca por su nombre (sin importar mayúsculas ni acentos) y, si no, por su posición
entre los favoritos reproducibles del primer nivel de Lyrion (las carpetas no cuentan). Un anuncio
se inserta tras la canción actual, se reproduce y se retira: el reproductor recupera su canción,
posición, volumen, estado, modo de repetición y encendido.

## Ejemplos de escenas

- **Radio de la mañana**: a las 7:30 entre semana, _Reproducir un favorito de Lyrion_ `FIP` en el
  reproductor de la cocina, y luego _Ajustar el volumen_ a 25.
- **Timbre**: cuando llaman a la puerta, _Reproducir un anuncio_ con la dirección de un MP3 de
  campanilla en cada reproductor de la planta baja, a volumen 60.
- **Salir de casa**: cuando se va la última persona, _Pausar todos los reproductores_.
- **Fiesta**: _Unirse a un grupo_ para el salón y la cocina, y _Salir del grupo_ a medianoche.

## Solución de problemas

- **«El servidor Lyrion no responde»**: compruebe la dirección y el puerto web (abra
  `http://<dirección>:9000` en un navegador desde la misma red).
- **«Lyrion rechazó el nombre de usuario o la contraseña»**: los mismos datos que la interfaz web de
  Lyrion.
- **Los cambios tardan 5 segundos**: el puerto CLI está cerrado o desactivado; Gladys lee entonces
  los reproductores cada 5 segundos. Compruebe el puerto 9090, o el plugin «CLI» de Lyrion.
- **Falta un reproductor**: debe estar conectado a este servidor (aparece en la interfaz web de
  Lyrion); después lance una búsqueda en la pestaña Descubrir.
- Registros: en la página de la integración; `LOG_LEVEL=debug` muestra cada lectura.

## Límites

- Un solo servidor Lyrion por integración; sin descubrimiento automático (Lyrion solo responde a
  consultas broadcast, que la sandbox no transmite): escriba su dirección.
- Las funciones de música no tienen fila en la caja «dispositivos de una habitación» de Gladys: use
  la caja Música o el widget Reproductores Lyrion.
- Un anuncio en un grupo suena en todo el grupo; con reproducción aleatoria, la posición devuelta
  puede variar. Un flujo sin fin se corta a los 10 minutos.
- Solo se ofrece el primer nivel de los favoritos.
- Solo red local: la integración habla con el servidor, nunca con un servicio en la nube.
