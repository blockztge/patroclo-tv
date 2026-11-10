<?php
// Proxy mínimo para probar Patroclo TV en el navegador con XAMPP.
// Muchos servidores de listas (y casi todos los Xtream) no permiten que una
// página web los consulte (CORS). La app empaquetada para el televisor NO usa
// este archivo: en Tizen esos pedidos funcionan directo.
// Solo atiende pedidos de la red local.

$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
if (!preg_match('/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/', $ip)) {
    http_response_code(403);
    exit('Solo disponible en la red local');
}

$url = isset($_GET['url']) ? $_GET['url'] : '';
if (!preg_match('#^https?://#i', $url)) {
    http_response_code(400);
    exit('URL inválida');
}

$ch = curl_init($url);
curl_setopt_array($ch, array(
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 90,
    CURLOPT_ENCODING => '',
    CURLOPT_USERAGENT => 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) PatrocloTV/1.0',
    // XAMPP en Windows suele no traer certificados raíz; es una herramienta local.
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => 0,
));
$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$error = curl_error($ch);
curl_close($ch);

if ($body === false) {
    http_response_code(502);
    exit('Error al conectar: ' . $error);
}
http_response_code($status ?: 200);
header('Content-Type: ' . ($type ?: 'text/plain; charset=utf-8'));
header('Cache-Control: no-store');
echo $body;
