import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import api from '../../api';
import { colors, fonts } from '../../theme';
import type { BarberoElegido, EspecialidadCliente, ProcedimientosBarberoCliente } from '../../types';
import { readError } from '../../utils/errors';
import { formatMoney } from '../../utils/format';

// Asistente de agendamiento. Los pasos 1 y 2 (barbería y barbero) viven en el
// inicio del cliente; aquí empieza el paso 3: elegir uno o varios procedimientos.
export function AgendarCitaScreen({
  barbero,
  onBack,
}: {
  barbero: BarberoElegido;
  onBack: () => void;
}) {
  const [data, setData] = useState<ProcedimientosBarberoCliente | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setSelectedIds([]);

    api
      .get<ProcedimientosBarberoCliente>(`/cliente/barberos/${barbero.id}/procedimientos`)
      .then((response) => active && setData(response.data))
      .catch((err) => active && setError(readError(err, 'No fue posible cargar los procedimientos.')))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [barbero.id]);

  const toggle = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const procedimientos = data?.procedimientos ?? [];

  return (
    <View>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>← Volver</Text>
      </Pressable>

      <Text style={styles.kicker}>Agendar cita con {barbero.nombre}</Text>
      <Text style={styles.title}>¿Qué te vas a hacer?</Text>
      <Text style={styles.hint}>
        {data?.origen === 'barberia'
          ? 'Este barbero no tiene especialidades asignadas: puedes elegir cualquier servicio de la barbería.'
          : 'Elige uno o varios servicios.'}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <Text style={styles.empty}>Cargando procedimientos...</Text>
      ) : procedimientos.length === 0 && !error ? (
        <Text style={styles.empty}>Esta barbería aún no tiene procedimientos disponibles.</Text>
      ) : (
        <View style={styles.list}>
          {procedimientos.map((item) => (
            <ProcedimientoCard
              key={item.id}
              item={item}
              selected={selectedIds.includes(item.id)}
              onPress={() => toggle(item.id)}
            />
          ))}
        </View>
      )}

      {selectedIds.length > 0 ? (
        <Text style={styles.selection}>
          {selectedIds.length === 1 ? '1 servicio elegido' : `${selectedIds.length} servicios elegidos`}
        </Text>
      ) : null}
    </View>
  );
}

function ProcedimientoCard({
  item,
  selected,
  onPress,
}: {
  item: EspecialidadCliente;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
    >
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{item.nombre}</Text>
        {item.descripcion ? <Text style={styles.cardText}>{item.descripcion}</Text> : null}
        <Text style={styles.cardMeta}>
          {formatMoney(item.precio)} · {item.duracionMinutos} min
        </Text>
      </View>
      <Text style={[styles.check, selected && styles.checkSelected]}>{selected ? '✓' : ''}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backButton: { alignSelf: 'flex-start', paddingVertical: 8 },
  backText: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 16 },
  kicker: { color: colors.darkGold, fontFamily: fonts.medium, fontSize: 21 },
  title: { color: colors.black, fontFamily: fonts.title, fontSize: 32, marginBottom: 6 },
  hint: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18, marginBottom: 16 },
  empty: { color: colors.gray, fontFamily: fonts.medium, fontSize: 20, marginBottom: 20 },
  error: { color: colors.danger, fontFamily: fonts.medium, fontSize: 18, marginBottom: 12 },
  list: { gap: 12, maxWidth: 680 },
  card: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  cardSelected: { backgroundColor: colors.softGold, borderColor: colors.gold },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { color: colors.black, fontFamily: fonts.title, fontSize: 21 },
  cardText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 17 },
  cardMeta: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 18 },
  check: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.white,
    fontFamily: fonts.title,
    fontSize: 18,
    height: 28,
    lineHeight: 26,
    overflow: 'hidden',
    textAlign: 'center',
    width: 28,
  },
  checkSelected: { backgroundColor: colors.black, borderColor: colors.black },
  selection: { color: colors.black, fontFamily: fonts.title, fontSize: 20, marginTop: 16 },
});
