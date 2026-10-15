import { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import api from '../api';
import { FormModal } from '../components/FormModal';
import { LabeledInput } from '../components/LabeledInput';
import { colors, fonts } from '../theme';
import type { BarberoAdmin, ProcedimientoAdmin, SessionProfile } from '../types';
import { readError } from '../utils/errors';
import { formatMoney } from '../utils/format';

const avatar = require('../../assets/user.png');
const plusIcon = require('../../assets/plus.png');

// Módulo 2 (tramo 1): el administrador gestiona los barberos de su barbería.
// Procedimientos y reseñas llegan en el siguiente tramo.
export function AdminHomeScreen({ profile }: { profile: SessionProfile | null }) {
  const { width } = useWindowDimensions();
  const isCompact = width < 620;
  const barberia = profile?.barberia;

  const [barberos, setBarberos] = useState<BarberoAdmin[]>([]);
  const [procedimientos, setProcedimientos] = useState<ProcedimientoAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [formTarget, setFormTarget] = useState<BarberoAdmin | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BarberoAdmin | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 4500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [barberosRes, procedimientosRes] = await Promise.all([
        api.get('/admin/barberos'),
        api.get('/admin/procedimientos'),
      ]);
      setBarberos(barberosRes.data);
      setProcedimientos(procedimientosRes.data);
    } catch (error) {
      showToast(readError(error, 'No fue posible cargar los barberos.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <View>
      <View style={[styles.header, isCompact && styles.headerCompact]}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>Panel del administrador</Text>
          <Text style={styles.title}>Hola, {profile?.nombre || 'Administrador'}</Text>
        </View>
        <Text style={styles.badge}>Administrador</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.cardLabel}>Tu barbería</Text>
        <Text style={styles.infoTitle}>{barberia?.nombre ?? 'Sin barbería asociada'}</Text>
        {barberia?.direccion ? <Text style={styles.cardText}>{barberia.direccion}</Text> : null}
        {barberia?.telefono ? <Text style={styles.cardText}>{barberia.telefono}</Text> : null}
      </View>

      <Text style={styles.sectionTitle}>Barberos</Text>
      <Pressable style={styles.primaryAction} onPress={() => setFormTarget('new')}>
        <Image source={plusIcon} style={styles.actionIcon} tintColor={colors.white} />
        <Text style={styles.primaryActionText}>Agregar barbero</Text>
      </Pressable>

      {barberos.length === 0 ? (
        <Text style={styles.empty}>
          {loading
            ? 'Cargando barberos...'
            : 'Aún no tienes barberos. Agrega el primero con el botón de arriba.'}
        </Text>
      ) : (
        <View style={styles.grid}>
          {barberos.map((barbero) => (
            <View key={barbero.id} style={[styles.card, isCompact && styles.fullWidthCard]}>
              <Image
                source={barbero.foto ? { uri: barbero.foto } : avatar}
                style={styles.avatar}
                resizeMode="cover"
              />
              <Text style={styles.cardTitle}>{barbero.nombre}</Text>
              {barbero.email ? <Text style={styles.cardText}>{barbero.email}</Text> : null}
              {barbero.telefono ? <Text style={styles.cardText}>{barbero.telefono}</Text> : null}
              <Text style={styles.cardText} numberOfLines={2}>
                {barbero.especialidades.map((item) => item.nombre).join(', ') ||
                  'Sin especialidades asignadas'}
              </Text>
              <Text style={styles.rating}>★ {barbero.promedioCalificacion.toFixed(1)}</Text>
              {barbero.pendienteCambioContrasena ? (
                <Text style={styles.pending}>Aún no cambia su contraseña temporal</Text>
              ) : null}
              <View style={styles.cardActions}>
                <Pressable style={styles.smallButton} onPress={() => setFormTarget(barbero)}>
                  <Text style={styles.smallButtonText}>Editar</Text>
                </Pressable>
                <Pressable style={styles.ghostButton} onPress={() => setDeleteTarget(barbero)}>
                  <Text style={styles.ghostButtonText}>Dar de baja</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      <BarberoFormModal
        open={formTarget !== null}
        barbero={formTarget === 'new' ? null : formTarget}
        procedimientos={procedimientos}
        onClose={() => setFormTarget(null)}
        onSaved={(message) => {
          setFormTarget(null);
          showToast(message);
          load();
        }}
      />

      <DeleteBarberoModal
        barbero={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={(message) => {
          setDeleteTarget(null);
          showToast(message);
          load();
        }}
      />

      {toast ? <Text style={styles.toast}>{toast}</Text> : null}
    </View>
  );
}

function BarberoFormModal({
  barbero,
  open,
  procedimientos,
  onClose,
  onSaved,
}: {
  barbero: BarberoAdmin | null;
  open: boolean;
  procedimientos: ProcedimientoAdmin[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = barbero !== null;
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNombre(barbero?.nombre ?? '');
      setEmail(barbero?.email ?? '');
      setTelefono(barbero?.telefono ?? '');
      setPassword('');
      setSelected(barbero?.procedimientoIds ?? []);
      setError('');
    }
  }, [open, barbero]);

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const submit = async () => {
    if (!isEdit && !password) {
      setError('Define una contraseña temporal para el barbero.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = isEdit
        ? await api.patch(`/admin/barberos/${barbero.id}`, {
            nombre,
            email,
            telefono,
            procedimientoIds: selected,
            ...(password ? { nuevaContrasenaTemporal: password } : {}),
          })
        : await api.post('/admin/barberos', {
            nombre,
            email,
            telefono,
            password,
            procedimientoIds: selected,
          });
      onSaved(response.data.message || 'Cambios guardados.');
    } catch (err) {
      setError(readError(err, 'No fue posible guardar el barbero.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      loading={saving}
      open={open}
      submitLabel={isEdit ? 'Guardar' : 'Crear barbero'}
      title={isEdit ? 'Editar barbero' : 'Agregar barbero'}
      onClose={onClose}
      onSubmit={submit}
    >
      <LabeledInput label="Nombre" value={nombre} onChangeText={setNombre} />
      <LabeledInput
        label="Correo"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <LabeledInput
        label="Teléfono (opcional)"
        value={telefono}
        onChangeText={setTelefono}
        keyboardType="phone-pad"
      />
      <LabeledInput
        label={isEdit ? 'Nueva contraseña temporal (opcional)' : 'Contraseña temporal'}
        hint={
          isEdit
            ? 'Solo si quieres restablecerla. El barbero deberá cambiarla al ingresar.'
            : 'Entrégasela al barbero: la cambiará en su primer ingreso. 8 o más caracteres, con letras y números.'
        }
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <View>
        <Text style={styles.fieldLabel}>Especialidades</Text>
        {procedimientos.filter((item) => item.activo).length === 0 ? (
          <Text style={styles.cardText}>Tu barbería aún no tiene procedimientos activos.</Text>
        ) : (
          <View style={styles.pillWrap}>
            {procedimientos
              .filter((item) => item.activo)
              .map((item) => {
                const isSelected = selected.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    style={[styles.pill, isSelected && styles.pillSelected]}
                    onPress={() => toggle(item.id)}
                  >
                    <Text style={[styles.pillText, isSelected && styles.pillTextSelected]}>
                      {item.nombre} · {formatMoney(item.precio)}
                    </Text>
                  </Pressable>
                );
              })}
          </View>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
  );
}

function DeleteBarberoModal({
  barbero,
  onClose,
  onDeleted,
}: {
  barbero: BarberoAdmin | null;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setError('');
  }, [barbero]);

  const submit = async () => {
    if (!barbero) return;

    setDeleting(true);
    setError('');
    try {
      const response = await api.delete(`/admin/barberos/${barbero.id}`);
      onDeleted(response.data.message || 'Barbero dado de baja.');
    } catch (err) {
      setError(readError(err, 'No fue posible dar de baja al barbero.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <FormModal
      danger
      loading={deleting}
      open={barbero !== null}
      submitLabel="Dar de baja"
      title="Dar de baja barbero"
      onClose={onClose}
      onSubmit={submit}
    >
      <Text style={styles.cardText}>
        {barbero?.nombre} dejará de poder iniciar sesión y desaparecerá de tu lista. Su historial
        de citas se conserva. Si tiene citas próximas, primero debes reprogramarlas o cancelarlas.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: 8,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    color: colors.darkGold,
    fontFamily: fonts.medium,
    fontSize: 21,
  },
  title: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 36,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.black,
    borderRadius: 8,
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 18,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  infoCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    marginBottom: 8,
    maxWidth: 520,
    padding: 18,
  },
  cardLabel: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 16,
  },
  infoTitle: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 26,
  },
  sectionTitle: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 26,
    marginBottom: 12,
    marginTop: 14,
  },
  primaryAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.gold,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
    minHeight: 54,
    paddingHorizontal: 18,
  },
  actionIcon: {
    height: 18,
    width: 18,
  },
  primaryActionText: {
    color: colors.white,
    fontFamily: fonts.title,
    fontSize: 18,
  },
  empty: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 20,
    marginBottom: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 260,
    flexGrow: 1,
    gap: 4,
    minWidth: 240,
    padding: 16,
  },
  fullWidthCard: {
    flexBasis: '100%',
    minWidth: '100%',
    width: '100%',
  },
  avatar: {
    backgroundColor: colors.softGold,
    borderRadius: 32,
    height: 64,
    width: 64,
  },
  cardTitle: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 22,
    marginTop: 6,
  },
  cardText: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 18,
  },
  rating: {
    color: colors.darkGold,
    fontFamily: fonts.title,
    fontSize: 18,
  },
  pending: {
    alignSelf: 'flex-start',
    backgroundColor: colors.softGold,
    borderRadius: 8,
    color: colors.darkGold,
    fontFamily: fonts.medium,
    fontSize: 16,
    marginTop: 4,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  smallButton: {
    backgroundColor: colors.black,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  smallButtonText: {
    color: colors.white,
    fontFamily: fonts.title,
    fontSize: 16,
  },
  ghostButton: {
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  ghostButtonText: {
    color: colors.darkGold,
    fontFamily: fonts.title,
    fontSize: 16,
  },
  fieldLabel: {
    color: colors.black,
    fontFamily: fonts.medium,
    fontSize: 19,
    marginBottom: 7,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pillSelected: {
    backgroundColor: colors.black,
    borderColor: colors.black,
  },
  pillText: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 17,
  },
  pillTextSelected: {
    color: colors.white,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.medium,
    fontSize: 18,
  },
  toast: {
    alignSelf: 'center',
    backgroundColor: colors.black,
    borderRadius: 8,
    bottom: 16,
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 18,
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingVertical: 10,
    position: 'absolute',
  },
});
