# Patroclo TV

App de IPTV para Smart TV Samsung (Tizen): canales en vivo, películas y series, todo con el control remoto.

## Qué incluye

- **Fuentes listas para usar:** Argentina, En español, Free-TV global, España y Argentina completa (con señales espejo).
- **Tu propio contenido:** lista M3U por URL o cuenta Xtream Codes (canales, películas y series con temporadas).
- **Películas:** clásicos completos de dominio público (Internet Archive) y fichas de estrenos.
- **TV en vivo:** categorías, lista rápida, cambio de canal con ▲▼ / CH+ CH−, número directo con 0-9.
- **Señales espejo:** si un canal no anda, la app prueba sola otra señal con el mismo nombre (o con el botón verde).
- **Favoritos** (botón amarillo), historial, búsqueda y "seguir viendo" en películas.
- Todo se guarda solo en el televisor (`localStorage`).

## Estructura

```
index.html        Página principal
config.xml        Manifiesto de la app para Tizen
icon.png          Ícono (512×512)
css/app.css       Estilos (pantalla de 1920×1080)
js/core.js        Utilidades, red, teclas del control
js/sources.js     Listas M3U, Xtream Codes, Internet Archive
js/nav.js         Navegación con flechas y diálogos
js/player.js      Reproductor (AVPlay de Samsung / HTML5 + hls.js)
js/app.js         Pantallas: inicio, en vivo, películas, series, buscar, favoritos, ajustes
js/lib/hls.min.js hls.js 1.5.20 (solo se usa en el navegador)
data/             Lista "Argentina completa", canales destacados y catálogo de películas
proxy.php         Solo para probar en el navegador con XAMPP (no va al televisor)
tizen-build.ps1   Empaqueta e instala en el televisor
```

El código está escrito en JavaScript ES5 sin herramientas de compilación, para que funcione en los
Samsung con Tizen 3.0 o posterior (modelos 2017 en adelante).

## Probar en la PC

Con Apache de XAMPP encendido, abrí <http://localhost/patroclo/>. Las flechas, Enter y Escape/Backspace
hacen de control remoto; `F` = favorito, `G` = otra señal, `I` = información.

En el navegador muchos canales no cargan porque sus servidores bloquean páginas web (CORS). `proxy.php`
resuelve la carga de listas y de Xtream, pero no el video. En el televisor no existe esa restricción.

## Desarrollar con la TV actualizándose sola

`tizen-build.ps1 -Dev` instala en el televisor **Patroclo TV (dev)**, un lanzador que carga la app
desde XAMPP en la PC (`tizen/dev/`). Cada 3 segundos consulta `dev-version.php` y, si cambió algún
archivo de `index.html`, `css/`, `js/` o `data/`, se recarga. Si hay un canal en pantalla, espera a
que se cierre.

- Se instala una sola vez; después alcanza con guardar los cambios en la PC.
- La PC tiene que estar encendida, con Apache, en la misma red que el televisor.
- Si la PC cambia de IP, el lanzador muestra un cuadro para escribir la nueva dirección.
- El firewall de Windows tiene que dejar entrar a Apache desde la red local. En PowerShell como administrador:

  ```powershell
  New-NetFirewallRule -DisplayName "Apache XAMPP (red local)" -Direction Inbound -Program "C:\xampp\apache\bin\httpd.exe" -Action Allow -RemoteAddress LocalSubnet
  ```

Cuando la app esté terminada, se instala la versión final (sin `-Dev`), que no depende de la PC.
Las dos pueden convivir en el televisor.

## Instalar en el televisor Samsung

1. **Instalá Tizen Studio** con el *TV Extension* y el *Samsung Certificate Extension*
   (<https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html>).
2. **Activá el modo desarrollador en la TV:** abrí *Apps*, marcá `1 2 3 4 5` con el control, activá
   *Developer mode*, escribí la IP de tu PC y reiniciá el televisor.
3. **Creá un certificado Samsung:** en Tizen Studio, *Tools → Certificate Manager → +* → *Samsung*,
   tipo *TV*. Conectá la TV desde *Device Manager* para que el certificado incluya su DUID.
   Anotá el nombre del perfil.
4. **Empaquetá e instalá** desde PowerShell, en esta carpeta:

   ```powershell
   .\tizen-build.ps1 -Cert NombreDelPerfil -Tv IP-DEL-TELEVISOR -Dev   # versión de desarrollo
   .\tizen-build.ps1 -Cert NombreDelPerfil -Tv IP-DEL-TELEVISOR        # versión final
   ```

   Sin `-Tv` solo genera `dist\PatrocloTV.wgt`.

También se puede abrir esta carpeta como proyecto en Tizen Studio (*File → Import → Tizen → Tizen Project*)
y usar *Run As → Tizen Web Application*.

## Control remoto

| Dónde | Tecla | Acción |
|---|---|---|
| Menús | ▲▼◀▶ / OK / Volver | Moverse, elegir, atrás |
| Cualquier canal o película | Amarillo | Agregar/quitar favorito |
| Viendo un canal | ▲▼ o CH+/CH− | Cambiar canal |
| Viendo un canal | 0-9 | Ir al número de canal |
| Viendo un canal | Verde | Probar otra señal |
| Viendo un canal | OK / Info | Mostrar u ocultar datos |
| Viendo una película | OK / Play | Pausa |
| Viendo una película | ◀▶ / REW FF | Retroceder/avanzar 10 / 30 segundos |
| Lista de canales | CH+/CH− | Avanzar de a una página |

## Limitaciones conocidas

- Los canales abiertos dependen de terceros: algunos se caen, cambian de dirección o solo funcionan en su país.
- Las señales que exigen un *referer* especial no se pueden forzar desde la TV (el *user-agent* sí).
- Los canales que emiten solo por YouTube se abren con el reproductor de YouTube, que puede no funcionar en todos los modelos.
- "Estrenos" son fichas informativas: no hay copia gratuita; se pueden buscar en tu propia lista.
- Las listas Xtream muy grandes no entran en el almacenamiento local y se vuelven a descargar al abrir la app.
