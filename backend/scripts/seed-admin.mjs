// =====================================================================
// EdgeTimer · Siembra del administrador de una barbería
//
// Crea (1) la cuenta en Supabase Auth, (2) su fila en `perfil` con rol
// 'admin' y (3) su fila en `administrador` ligada a la barbería.
// La barbería debe existir ya (AlphaCorte ya está sembrada).
//
// Uso (desde la carpeta backend/):
//   npm run seed:admin
//
// Variables de entorno (en backend/.env, que NO debe subirse a GitHub):
//   SUPABASE_URL                 (ya la tienes)
//   SUPABASE_SERVICE_ROLE_KEY    (ya la tienes)
//   SEED_ADMIN_EMAIL             correo con el que entrará el administrador
//   SEED_ADMIN_PASSWORD          mínimo 8 caracteres, letras y números
//   SEED_ADMIN_NAME              opcional
//   SEED_BARBERIA_NOMBRE         opcional (por defecto AlphaCorte)
//
// Requiere Node 20 o superior.
// =====================================================================
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_NAME = 'Juan Felipe Gónzales Restrepo',
  SEED_BARBERIA_NOMBRE = 'AlphaCorte',
} = process.env;

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  fail('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el .env');
}
if (!SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD) {
  fail('Define SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD en el .env');
}

const email = SEED_ADMIN_EMAIL.trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail('SEED_ADMIN_EMAIL no es un correo válido');
}
if (
  SEED_ADMIN_PASSWORD.length < 8 ||
  !/[A-Za-z]/.test(SEED_ADMIN_PASSWORD) ||
  !/[0-9]/.test(SEED_ADMIN_PASSWORD)
) {
  fail('La contraseña debe tener mínimo 8 caracteres y combinar letras y números');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1. La barbería debe existir
const { data: barberia, error: errBarberia } = await supabase
  .from('barberia')
  .select('id_barberia, nombre')
  .eq('nombre', SEED_BARBERIA_NOMBRE)
  .maybeSingle();

if (errBarberia) fail(`No se pudo consultar la barbería: ${errBarberia.message}`);
if (!barberia) fail(`No existe la barbería "${SEED_BARBERIA_NOMBRE}"`);

// 2. Cuenta en Supabase Auth (ya confirmada: el admin no necesita verificar correo)
const { data: created, error: errUser } = await supabase.auth.admin.createUser({
  email,
  password: SEED_ADMIN_PASSWORD,
  email_confirm: true,
  user_metadata: { nombre: SEED_ADMIN_NAME, rol: 'admin' },
});

if (errUser) fail(`No se pudo crear la cuenta: ${errUser.message}`);
const userId = created.user.id;

// Si algo falla después, se deshace todo para no dejar cuentas a medias.
async function rollback() {
  await supabase.from('administrador').delete().eq('user_id', userId);
  await supabase.from('perfil').delete().eq('user_id', userId);
  await supabase.auth.admin.deleteUser(userId);
}

// 3. Perfil con rol admin
const { error: errPerfil } = await supabase
  .from('perfil')
  .insert({ user_id: userId, rol: 'admin' });

if (errPerfil) {
  await rollback();
  fail(`No se pudo crear el perfil: ${errPerfil.message}`);
}

// 4. Administrador ligado a la barbería
const { error: errAdmin } = await supabase.from('administrador').insert({
  user_id: userId,
  id_barberia: barberia.id_barberia,
  nombre_administrador: SEED_ADMIN_NAME,
});

if (errAdmin) {
  await rollback();
  fail(`No se pudo crear el administrador: ${errAdmin.message}`);
}

console.log(`✔ Administrador creado para ${barberia.nombre}`);
console.log(`  Nombre: ${SEED_ADMIN_NAME}`);
console.log(`  Correo: ${email}`);
