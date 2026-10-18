import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import api from '../../api';
import { FormModal } from '../../components/FormModal';
import { LabeledInput } from '../../components/LabeledInput';
import { colors, fonts } from '../../theme';
import type { ProcedimientoAdmin } from '../../types';
import { readError } from '../../utils/errors';
import { formatMoney } from '../../utils/format';

const plusIcon = require('../../../assets/plus.png');

// La agenda trabaja en bloques de 15 minutos.
const DURATIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180];

// Pestaña "Procedimientos" del panel del administrador (RF-11).
export function AdminProcedimientos() {
  const { width } = useWindowDimensions();
  const isCompact = width < 620;

  const [items, setItems] = useState<ProcedimientoAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [formTarget, setFormTarget] = useState<ProcedimientoAdmin | 'new' | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 4500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get('/admin/procedimientos');
      setItems(response.data);
    } catch (error) {
      showToast(readError(error, 'No fue posible cargar los procedimientos.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleActive = async (item: ProcedimientoAdmin) => {
    try {
      const response = await api.patch(`/admin/procedimientos/${item.id}`, {
        activo: !item.activo,
      });
      showToast(response.data.message);
      load();
    } catch (error) {
      showToast(readError(error, 'No fue posible cambiar el estado.'));
    }
  };

  return (
    <View>
      <Pressable style={styles.primaryAction} onPress={() => setFormTarget('new')}>
        <Image source={plusIcon} style={styles.actionIcon} tintColor={colors.white} />
        <Text style={styles.primaryActionText}>Agregar procedimiento</Text>
      </Pressable>

      {items.length === 0 ? (
        <Text style={styles.empty}>
          {loading ? 'Cargando procedimientos...' : 'Aún no tienes procedimientos.'}
        </Text>
      ) : (
        <View style={styles.grid}>
          {items.map((item) => (
            <View
              key={item.id}
              style={[styles.card, isCompact && styles.fullWidthCard, !item.activo && styles.inactive]}
            >
              <Text style={styles.cardTitle}>{item.nombre}</Text>
              {item.descripcion ? <Text style={styles.cardText}>{item.descripcion}</Text> : null}
              <Text style={styles.price}>{formatMoney(item.precio)}</Text>
              <Text style={styles.cardText}>{formatDuration(item.duracionMinutos)}</Text>
              <Text style={[styles.status, !item.activo && styles.statusInactive]}>
                {item.activo ? 'Activo' : 'Inactivo'}
              </Text>
              <View style={styles.cardActions}>
                <Pressable style={styles.smallButton} onPress={() => setFormTarget(item)}>
                  <Text style={styles.smallButtonText}>Editar</Text>
                </Pressable>
                <Pressable style={styles.ghostButton} onPress={() => toggleActive(item)}>
                  <Text style={styles.ghostButtonText}>
                    {item.activo ? 'Desactivar' : 'Activar'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      <ProcedimientoFormModal
        open={formTarget !== null}
        item={formTarget === 'new' ? null : formTarget}
        onClose={() => setFormTarget(null)}
        onSaved={(message) => {
          setFormTarget(null);
          showToast(message);
          load();
        }}
      />

      {toast ? <Text style={styles.toast}>{toast}</Text> : null}
    </View>
  );
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function ProcedimientoFormModal({
  item,
  open,
  onClose,
  onSaved,
}: {
  item: ProcedimientoAdmin | null;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEdit = item !== null;
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [precio, setPrecio] = useState('');
  const [duracion, setDuracion] = useState(30);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNombre(item?.nombre ?? '');
      setDescripcion(item?.descripcion ?? '');
      setPrecio(item ? String(item.precio) : '');
      setDuracion(item?.duracionMinutos ?? 30);
      setError('');
    }
  }, [open, item]);

  const submit = async () => {
    // Se aceptan puntos y espacios al escribir el precio ("35.000" o "35 000").
    const cleanPrice = precio.replace(/[.\s]/g, '');
    if (!nombre.trim() || !cleanPrice) {
      setError('El nombre y el precio son obligatorios.');
      return;
    }

    const body = { nombre, descripcion, precio: cleanPrice, duracionMinutos: duracion };

    setSaving(true);
    setError('');
    try {
      const response = isEdit
        ? await api.patch(`/admin/procedimientos/${item.id}`, body)
        : await api.post('/admin/procedimientos', body);
      onSaved(response.data.message || 'Cambios guardados.');
    } catch (err) {
      setError(readError(err, 'No fue posible guardar el procedimiento.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      loading={saving}
      open={open}
      submitLabel={isEdit ? 'Guardar' : 'Crear procedimiento'}
      title={isEdit ? 'Editar procedimiento' : 'Agregar procedimiento'}
      onClose={onClose}
      onSubmit={submit}
    >
      <LabeledInput label="Nombre" value={nombre} onChangeText={setNombre} />
      <LabeledInput label="Descripción (opcional)" value={descripcion} onChangeText={setDescripcion} />
      <LabeledInput
        label="Precio (COP)"
        hint={
          isEdit
            ? 'Los cambios no afectan las citas ya agendadas: conservan el precio con el que se agendaron.'
            : 'En pesos colombianos, sin decimales.'
        }
        value={precio}
        onChangeText={setPrecio}
        keyboardType="numeric"
      />
      <View>
        <Text style={styles.fieldLabel}>Duración</Text>
        <View style={styles.pillWrap}>
          {DURATIONS.map((minutes) => (
            <Pressable
              key={minutes}
              style={[styles.pill, duracion === minutes && styles.pillSelected]}
              onPress={() => setDuracion(minutes)}
            >
              <Text style={[styles.pillText, duracion === minutes && styles.pillTextSelected]}>
                {formatDuration(minutes)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
  );
}

const styles = StyleSheet.create({
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
  actionIcon: { height: 18, width: 18 },
  primaryActionText: { color: colors.white, fontFamily: fonts.title, fontSize: 18 },
  empty: { color: colors.gray, fontFamily: fonts.medium, fontSize: 20, marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
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
  fullWidthCard: { flexBasis: '100%', minWidth: '100%', width: '100%' },
  inactive: { opacity: 0.6 },
  cardTitle: { color: colors.black, fontFamily: fonts.title, fontSize: 22 },
  cardText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18 },
  price: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 20, marginTop: 2 },
  status: {
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
  statusInactive: { backgroundColor: '#ECECEC', color: colors.muted },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  smallButton: {
    backgroundColor: colors.black,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  smallButtonText: { color: colors.white, fontFamily: fonts.title, fontSize: 16 },
  ghostButton: {
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  ghostButtonText: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 16 },
  fieldLabel: { color: colors.black, fontFamily: fonts.medium, fontSize: 19, marginBottom: 7 },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pillSelected: { backgroundColor: colors.black, borderColor: colors.black },
  pillText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 17 },
  pillTextSelected: { color: colors.white },
  error: { color: colors.danger, fontFamily: fonts.medium, fontSize: 18 },
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
