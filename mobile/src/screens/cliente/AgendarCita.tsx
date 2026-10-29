import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import api from '../../api';
import { colors, fonts } from '../../theme';
import type {
  BarberoElegido,
  DisponibilidadCliente,
  EspecialidadCliente,
  ProcedimientosBarberoCliente,
} from '../../types';
import { readError } from '../../utils/errors';
import { formatMoney, formatShortDate } from '../../utils/format';

// Asistente de agendamiento. Los pasos 1 y 2 (barbería y barbero) viven en el
// inicio del cliente; aquí están el paso 3 (procedimientos) y el 4 (fecha y hora).
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
  const [step, setStep] = useState<'procedimientos' | 'fecha'>('procedimientos');
  const [disponibilidad, setDisponibilidad] = useState<DisponibilidadCliente | null>(null);
  const [loadingDias, setLoadingDias] = useState(false);
  const [errorDias, setErrorDias] = useState('');
  const [fecha, setFecha] = useState<string | null>(null);
  const [hora, setHora] = useState<string | null>(null);

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

  const goToFecha = () => {
    setStep('fecha');
    setFecha(null);
    setHora(null);
    setDisponibilidad(null);
    setErrorDias('');
    setLoadingDias(true);

    api
      .get<DisponibilidadCliente>(`/cliente/barberos/${barbero.id}/disponibilidad`, {
        params: { procedimientos: selectedIds.join(',') },
      })
      .then((response) => setDisponibilidad(response.data))
      .catch((err) => setErrorDias(readError(err, 'No fue posible cargar las horas disponibles.')))
      .finally(() => setLoadingDias(false));
  };

  // Atrás en el paso 4 vuelve al 3 conservando los procedimientos elegidos.
  const back = () => (step === 'fecha' ? setStep('procedimientos') : onBack());

  if (step === 'fecha') {
    return (
      <FechaStep
        barbero={barbero}
        disponibilidad={disponibilidad}
        error={errorDias}
        fecha={fecha}
        hora={hora}
        loading={loadingDias}
        onBack={back}
        onSelectFecha={(value) => {
          setFecha(value);
          setHora(null);
        }}
        onSelectHora={setHora}
      />
    );
  }

  return (
    <View>
      <Pressable onPress={back} style={styles.backButton}>
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

      <Pressable
        disabled={selectedIds.length === 0}
        style={[styles.primaryButton, selectedIds.length === 0 && styles.disabled]}
        onPress={goToFecha}
      >
        <Text style={styles.primaryButtonText}>Continuar</Text>
      </Pressable>
    </View>
  );
}

// Paso 4: solo se muestran fechas y horas en las que el barbero puede atender
// una cita de la duración elegida (el servidor ya descontó citas ocupadas).
function FechaStep({
  barbero,
  disponibilidad,
  error,
  fecha,
  hora,
  loading,
  onBack,
  onSelectFecha,
  onSelectHora,
}: {
  barbero: BarberoElegido;
  disponibilidad: DisponibilidadCliente | null;
  error: string;
  fecha: string | null;
  hora: string | null;
  loading: boolean;
  onBack: () => void;
  onSelectFecha: (fecha: string) => void;
  onSelectHora: (hora: string) => void;
}) {
  const dias = disponibilidad?.dias ?? [];
  const horas = dias.find((dia) => dia.fecha === fecha)?.horas ?? [];

  return (
    <View>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Text style={styles.backText}>← Cambiar servicios</Text>
      </Pressable>

      <Text style={styles.kicker}>Agendar cita con {barbero.nombre}</Text>
      <Text style={styles.title}>Elige fecha y hora</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <Text style={styles.empty}>Buscando horas disponibles...</Text>
      ) : disponibilidad && dias.length === 0 ? (
        <Text style={styles.empty}>
          No hay horas disponibles entre el {formatShortDate(disponibilidad.desde)} y el{' '}
          {formatShortDate(disponibilidad.hasta)} para la duración de estos servicios. Prueba con
          menos servicios u otro barbero.
        </Text>
      ) : disponibilidad ? (
        <View>
          <Text style={styles.sectionLabel}>Día</Text>
          <View style={styles.pillWrap}>
            {dias.map((dia) => (
              <Pressable
                key={dia.fecha}
                style={[styles.pill, fecha === dia.fecha && styles.pillSelected]}
                onPress={() => onSelectFecha(dia.fecha)}
              >
                <Text style={[styles.pillText, fecha === dia.fecha && styles.pillTextSelected]}>
                  {formatShortDate(dia.fecha)}
                </Text>
              </Pressable>
            ))}
          </View>

          {fecha ? (
            <View>
              <Text style={styles.sectionLabel}>Hora</Text>
              <View style={styles.pillWrap}>
                {horas.map((item) => (
                  <Pressable
                    key={item}
                    style={[styles.pill, hora === item && styles.pillSelected]}
                    onPress={() => onSelectHora(item)}
                  >
                    <Text style={[styles.pillText, hora === item && styles.pillTextSelected]}>
                      {item}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {fecha && hora ? (
            <Text style={styles.selection}>
              Elegiste: {formatShortDate(fecha)}, {hora}
            </Text>
          ) : null}
        </View>
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
  primaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.gold,
    borderRadius: 8,
    marginTop: 16,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  primaryButtonText: { color: colors.white, fontFamily: fonts.title, fontSize: 18 },
  disabled: { opacity: 0.45 },
  sectionLabel: {
    color: colors.black,
    fontFamily: fonts.medium,
    fontSize: 19,
    marginBottom: 8,
    marginTop: 12,
  },
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
});
