// Verificacion basica de CI: sin base de datos, sin variables de entorno.
// 1. Sintaxis de todos los .js del proyecto (excluye node_modules).
// 2. Cada .ejs (incluyendo partials) compila sin errores de sintaxis EJS.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const raiz = path.join(__dirname, '..');
let huboError = false;

function listarArchivos(dir, extension) {
  const resultado = [];
  for (const nombre of fs.readdirSync(dir)) {
    if (nombre === 'node_modules') continue;
    const ruta = path.join(dir, nombre);
    if (fs.statSync(ruta).isDirectory()) {
      resultado.push(...listarArchivos(ruta, extension));
    } else if (nombre.endsWith(extension)) {
      resultado.push(ruta);
    }
  }
  return resultado;
}

for (const archivo of listarArchivos(raiz, '.js')) {
  if (archivo === __filename) continue;
  try {
    execFileSync(process.execPath, ['--check', archivo], { stdio: 'pipe' });
    console.log('OK  ' + path.relative(raiz, archivo));
  } catch (err) {
    huboError = true;
    console.error('FAIL ' + path.relative(raiz, archivo));
    console.error(err.stderr ? err.stderr.toString() : err.message);
  }
}

for (const archivo of listarArchivos(path.join(raiz, 'views'), '.ejs')) {
  try {
    ejs.compile(fs.readFileSync(archivo, 'utf8'), { filename: archivo });
    console.log('OK  ' + path.relative(raiz, archivo));
  } catch (err) {
    huboError = true;
    console.error('FAIL ' + path.relative(raiz, archivo));
    console.error(err.message);
  }
}

if (huboError) {
  console.error('\nVerificacion de CI fallo.');
  process.exit(1);
}
console.log('\nVerificacion de CI OK.');
