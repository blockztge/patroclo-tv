<?php
// Solo para desarrollo: el lanzador de la TV consulta este archivo cada pocos
// segundos y se recarga cuando cambió algún archivo de la app.
// No se incluye en el paquete final para el televisor.

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');

$latest = filemtime(__DIR__ . '/index.html');
foreach (array('css', 'js', 'data') as $dir) {
    $files = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(__DIR__ . '/' . $dir, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($files as $file) {
        $latest = max($latest, $file->getMTime());
    }
}
echo $latest;
