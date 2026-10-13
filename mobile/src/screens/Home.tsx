import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import api from '../api';
import { colors, fonts } from '../theme';
import type { Barbero, Cita, Procedimiento, Role, SessionProfile, SlotDisponible } from '../types';
import { addMinutesToTime, buildHourOptions, formatMoney, formatShortDate, todayInputValue } from '../utils/format';

const avatar = require('../../assets/user.png');
const plusIcon = require('../../assets/plus.png');
const hourOptions = buildHourOptions();
const startHourOptions = hourOptions.filter((hour) => hour < '18:00');

export function HomeScreen({
  profile,
  role,
  onViewBarbero,
}: {
  profile: SessionProfile | null;
  role: Role;
  onViewBarbero?: (barberoId: string) => void;
}) {
  const isBarber = role === 'barbero';
  const { width } = useWindowDimensions();
  const isCompact = width < 620;
  const [barberos, setBarberos] = useState<Barbero[]>([]);
  const [procedimientos, setProcedimientos] = useState<Procedimiento[]>([]);
  const [slots, setSlots] = useState<SlotDisponible[]>([]);
  const [citas, setCitas] = useState<Cita[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const [slotOpen, setSlotOpen] = useState(false);
  const [reserveSlot, setReserveSlot] = useState<SlotDisponible | null>(null);
  const [selectedBarberId, setSelectedBarberId] = useState('');

  const welcomeName = profile?.nombre || profile?.usuario || 'Usuario';
  const pendingRequests = citas.filter((cita) => cita.estado === 'pendiente');

  const loadData = async () => {
    if (!profile?.id) return;

    setLoading(true);
    try {
      const [barberosRes, procedimientosRes, citasRes, slotsRes] = await Promise.all([
        api.get('/catalogos/barberos'),
        api.get('/catalogos/procedimientos'),
        api.get('/citas', { params: { role, profileId: profile.id } }),
        api.get('/slots', { params: isBarber ? { profileId: profile.id } : {} }),
      ]);
      setBarberos(barberosRes.data);
      setProcedimientos(procedimientosRes.data);
      setCitas(citasRes.data);
      setSlots(slotsRes.data);
    } catch (error: any) {
      setToast(error?.response?.data?.message || 'No fue posible cargar el Home.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [profile?.id, role]);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 3500);
  };

  const runAction = async (action: () => Promise<any>, fallback: string) => {
    try {
      const response = await action();
      showToast(response.data?.message || fallback);
      await loadData();
    } catch (error: any) {
      showToast(error?.response?.data?.message || fallback);
    }
  };

  return (
    <View>
      <View style={[styles.header, isCompact && styles.headerCompact]}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>{isBarber ? 'Home barbero' : 'Home cliente'}</Text>
          <Text style={styles.title}>Hola, {welcomeName}</Text>
        </View>
        <Text style={[styles.badge, isCompact && styles.badgeCompact]}>
          {isBarber ? 'Barbero' : 'Cliente'}
        </Text>
      </View>

      <Pressable
        style={styles.primaryAction}
        onPress={() => (isBarber ? setSlotOpen(true) : setRequestOpen(true))}
      >
        <Image source={plusIcon} style={styles.actionIcon} tintColor={colors.white} />
        <Text style={styles.primaryActionText}>
          {isBarber ? 'Abrir nuevo horario' : 'Solicitar nueva cita'}
        </Text>
      </Pressable>

      {isBarber ? (
        <BarberHome
          citas={pendingRequests}
          isCompact={isCompact}
          loading={loading}
          onAccept={(id) =>
            runAction(
              () => api.patch(`/citas/${id}/aceptar`, { role, profileId: profile?.id }),
              'Solicitud aceptada.',
            )
          }
          onReject={(id) =>
            runAction(
              () => api.patch(`/citas/${id}/rechazar`, { role, profileId: profile?.id }),
              'Solicitud rechazada.',
            )
          }
        />
      ) : (
        <ClientHome
          barberos={barberos}
          isCompact={isCompact}
          loading={loading}
          slots={slots}
          onReserve={setReserveSlot}
          onSelectBarber={(id) => {
            setSelectedBarberId(id);
            setRequestOpen(true);
          }}
          onViewBarbero={onViewBarbero}
        />
      )}

      <SlotModal
        open={slotOpen}
        onClose={() => setSlotOpen(false)}
        onSubmit={(payload) =>
          runAction(
            () => api.post('/slots', { profileId: profile?.id, ...payload }),
            'Horario disponible creado exitosamente.',
          ).then(() => setSlotOpen(false))
        }
      />

      <RequestModal
        barberos={barberos}
        defaultBarberId={selectedBarberId}
        open={requestOpen}
        procedimientos={procedimientos}
        onClose={() => {
          setSelectedBarberId('');
          setRequestOpen(false);
        }}
        onSubmit={(payload) =>
          runAction(
            () => api.post('/citas/solicitar', { profileId: profile?.id, ...payload }),
            'Solicitud enviada.',
          ).then(() => {
            setSelectedBarberId('');
            setRequestOpen(false);
          })
        }
      />

      <ReserveModal
        open={!!reserveSlot}
        procedimientos={procedimientos}
        slot={reserveSlot}
        onClose={() => setReserveSlot(null)}
        onSubmit={(payload) =>
          runAction(
            () =>
              api.post('/citas/reservar', {
                profileId: profile?.id,
                slotId: reserveSlot?.id,
                ...payload,
              }),
            'Cita reservada exitosamente.',
          ).then(() => setReserveSlot(null))
        }
      />

      {toast ? <Text style={styles.toast}>{toast}</Text> : null}
    </View>
  );
}

function BarberHome({
  citas,
  isCompact,
  loading,
  onAccept,
  onReject,
}: {
  citas: Cita[];
  isCompact: boolean;
  loading: boolean;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <View>
      <SectionTitle title="Solicitudes de citas" />
      {citas.length === 0 ? (
        <Text style={styles.empty}>
          {loading ? 'Cargando solicitudes...' : 'No tienes solicitudes de citas pendientes.'}
        </Text>
      ) : (
        <View style={styles.grid}>
          {citas.map((cita) => (
            <AppointmentCard
              key={cita.id}
              cita={cita}
              primaryLabel="Aceptar"
              secondaryLabel="Rechazar"
              title={cita.cliente.nombre}
              compact={isCompact}
              onPrimary={() => onAccept(cita.id)}
              onSecondary={() => onReject(cita.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function ClientHome({
  barberos,
  isCompact,
  loading,
  slots,
  onReserve,
  onSelectBarber,
  onViewBarbero,
}: {
  barberos: Barbero[];
  isCompact: boolean;
  loading: boolean;
  slots: SlotDisponible[];
  onReserve: (slot: SlotDisponible) => void;
  onSelectBarber: (id: string) => void;
  onViewBarbero?: (barberoId: string) => void;
}) {
  return (
    <View>
      <SectionTitle title="Horarios disponibles" />
      {slots.length === 0 ? (
        <Text style={styles.empty}>
          {loading
            ? 'Cargando horarios...'
            : 'No hay horarios disponibles por el momento. Puedes solicitar una cita con el boton de arriba.'}
        </Text>
      ) : (
        <View style={styles.horizontalList}>
          {slots.map((slot) => (
            <View key={slot.id} style={[styles.slotCard, isCompact && styles.fullWidthCard]}>
              <Avatar source={slot.barbero.foto} size={46} />
              <Text style={styles.cardTitle}>{slot.barbero.nombre}</Text>
              <Text style={styles.cardText}>{formatShortDate(slot.fecha)}</Text>
              <Text style={styles.cardText}>
                Inicio {slot.horaInicio}
              </Text>
              <Pressable style={[styles.smallButton, styles.reserveButton]} onPress={() => onReserve(slot)}>
                <Text style={styles.smallButtonText}>Reservar</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <SectionTitle title="Barberos AlphaCorte" />
      <View style={styles.grid}>
        {barberos.map((barbero) => (
          <Pressable
            key={barbero.id}
            style={[styles.barberCard, isCompact && styles.fullWidthCard]}
            onPress={() => onViewBarbero?.(barbero.id)}
          >
            <Avatar source={barbero.foto} size={78} />
            <Text style={styles.cardTitle}>{barbero.nombre}</Text>
            <Text style={styles.cardText} numberOfLines={2}>
              {barbero.especialidades.map((item) => item.nombre).join(', ') || 'Servicios generales'}
            </Text>
            <Text style={styles.cardText}>{barbero.horarioLaboral}</Text>
            <Text style={styles.rating}>* {barbero.promedioCalificacion.toFixed(1)}</Text>
            <Pressable
              style={styles.smallButton}
              onPress={(e) => {
                e.stopPropagation?.();
                onSelectBarber(barbero.id);
              }}
            >
              <Text style={styles.smallButtonText}>Solicitar Cita</Text>
            </Pressable>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function RequestModal({
  barberos,
  defaultBarberId,
  open,
  procedimientos,
  onClose,
  onSubmit,
}: {
  barberos: Barbero[];
  defaultBarberId: string;
  open: boolean;
  procedimientos: Procedimiento[];
  onClose: () => void;
  onSubmit: (payload: {
    idBarbero: string;
    procedimientoIds: string[];
    fecha: string;
    horaInicio: string;
  }) => Promise<void>;
}) {
  const [idBarbero, setIdBarbero] = useState(defaultBarberId);
  const [procedimientoIds, setProcedimientoIds] = useState<string[]>([]);
  const [fecha, setFecha] = useState(todayInputValue());
  const [horaInicio, setHoraInicio] = useState('09:00');
  const [error, setError] = useState('');

  useEffect(() => {
    setIdBarbero(defaultBarberId);
  }, [defaultBarberId, open]);

  const total = useMemo(
    () =>
      procedimientos
        .filter((item) => procedimientoIds.includes(item.id))
        .reduce((sum, item) => sum + item.precio, 0),
    [procedimientos, procedimientoIds],
  );
  const totalDuration = useMemo(
    () =>
      procedimientos
        .filter((item) => procedimientoIds.includes(item.id))
        .reduce((sum, item) => sum + item.duracionMinutos, 0),
    [procedimientos, procedimientoIds],
  );
  const horaFin = totalDuration > 0 ? addMinutesToTime(horaInicio, totalDuration) : '';

  const submit = async () => {
    if (!idBarbero || procedimientoIds.length === 0 || !fecha || !horaInicio) {
      setError('Todos los campos son obligatorios.');
      return;
    }
    setError('');
    await onSubmit({ idBarbero, procedimientoIds, fecha, horaInicio });
  };

  return (
    <FormModal open={open} title="Solicitar nueva cita" onClose={onClose} onSubmit={submit} submitLabel="Enviar solicitud">
      <SelectPills
        label="Barbero"
        options={barberos.map((item) => ({ id: item.id, label: item.nombre }))}
        selectedIds={idBarbero ? [idBarbero] : []}
        single
        onChange={(ids) => setIdBarbero(ids[0] || '')}
      />
      <ProcedurePicker
        procedimientos={procedimientos}
        selectedIds={procedimientoIds}
        onChange={setProcedimientoIds}
      />
      <DateInput value={fecha} onChange={setFecha} />
      <SelectPills
        label="Hora deseada"
        options={startHourOptions.map((hour) => ({ id: hour, label: hour }))}
        selectedIds={[horaInicio]}
        single
        onChange={(ids) => setHoraInicio(ids[0] || '')}
      />
      {horaFin ? (
        <Text style={styles.cardText}>
          Duracion estimada: {totalDuration} min - {horaInicio} - {horaFin}
        </Text>
      ) : null}
      {horaFin > '18:00' ? (
        <Text style={styles.error}>La cita debe terminar antes de las 18:00.</Text>
      ) : null}
      <Text style={styles.total}>Total: {formatMoney(total)}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
  );
}

function ReserveModal({
  open,
  procedimientos,
  slot,
  onClose,
  onSubmit,
}: {
  open: boolean;
  procedimientos: Procedimiento[];
  slot: SlotDisponible | null;
  onClose: () => void;
  onSubmit: (payload: { procedimientoIds: string[] }) => Promise<void>;
}) {
  const [procedimientoIds, setProcedimientoIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const total = procedimientos
    .filter((item) => procedimientoIds.includes(item.id))
    .reduce((sum, item) => sum + item.precio, 0);
  const totalDuration = procedimientos
    .filter((item) => procedimientoIds.includes(item.id))
    .reduce((sum, item) => sum + item.duracionMinutos, 0);
  const horaFin = slot && totalDuration > 0 ? addMinutesToTime(slot.horaInicio, totalDuration) : '';

  const submit = async () => {
    if (procedimientoIds.length === 0) {
      setError('Selecciona al menos un procedimiento.');
      return;
    }
    setError('');
    await onSubmit({ procedimientoIds });
    setProcedimientoIds([]);
  };

  return (
    <FormModal open={open} title="Reservar cita" onClose={onClose} onSubmit={submit} submitLabel="Confirmar reserva">
      {slot && (
        <View style={styles.readonlyBox}>
          <Avatar source={slot.barbero.foto} size={48} />
          <View>
            <Text style={styles.cardTitle}>{slot.barbero.nombre}</Text>
            <Text style={styles.cardText}>
              {formatShortDate(slot.fecha)} - Inicio {slot.horaInicio}
            </Text>
          </View>
        </View>
      )}
      <ProcedurePicker
        procedimientos={procedimientos}
        selectedIds={procedimientoIds}
        onChange={setProcedimientoIds}
      />
      {slot && horaFin ? (
        <Text style={styles.cardText}>
          Duracion estimada: {totalDuration} min - {slot.horaInicio} - {horaFin}
        </Text>
      ) : null}
      {horaFin > '18:00' ? (
        <Text style={styles.error}>La cita debe terminar antes de las 18:00.</Text>
      ) : null}
      <Text style={styles.total}>Total: {formatMoney(total)}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
  );
}

function SlotModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { fecha: string; horaInicio: string }) => Promise<void>;
}) {
  const [fecha, setFecha] = useState(todayInputValue());
  const [horaInicio, setHoraInicio] = useState('09:00');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!fecha || !horaInicio) {
      setError('Todos los campos son obligatorios.');
      return;
    }
    setError('');
    await onSubmit({ fecha, horaInicio });
  };

  return (
    <FormModal open={open} title="Abrir nuevo horario" onClose={onClose} onSubmit={submit} submitLabel="Guardar">
      <DateInput value={fecha} onChange={setFecha} />
      <SelectPills
        label="Hora de inicio"
        options={startHourOptions.map((hour) => ({ id: hour, label: hour }))}
        selectedIds={[horaInicio]}
        single
        onChange={(ids) => setHoraInicio(ids[0] || '')}
      />
      <Text style={styles.cardText}>
        Se publicará como inicio disponible de 15 minutos. La duracion final se calcula cuando el cliente elige procedimientos.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
  );
}

function FormModal({
  children,
  open,
  title,
  submitLabel,
  onClose,
  onSubmit,
}: {
  children: ReactNode;
  open: boolean;
  title: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal animationType="fade" transparent visible={open} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <ScrollView
            contentContainerStyle={styles.modalScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable style={styles.secondaryAction} onPress={onClose}>
              <Text style={styles.secondaryActionText}>Cancelar</Text>
            </Pressable>
            <Pressable style={styles.modalSubmit} onPress={onSubmit}>
              <Text style={styles.modalSubmitText}>{submitLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ProcedurePicker({
  procedimientos,
  selectedIds,
  onChange,
}: {
  procedimientos: Procedimiento[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <SelectPills
      label="Procedimientos"
      options={procedimientos.map((item) => ({
        id: item.id,
        label: `${item.nombre} - ${item.duracionMinutos} min - ${formatMoney(item.precio)}`,
      }))}
      selectedIds={selectedIds}
      onChange={onChange}
    />
  );
}

function SelectPills({
  label,
  options,
  selectedIds,
  single,
  onChange,
}: {
  label: string;
  options: { id: string; label: string }[];
  selectedIds: string[];
  single?: boolean;
  onChange: (ids: string[]) => void;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.pillWrap}>
        {options.map((option) => {
          const selected = selectedIds.includes(option.id);
          return (
            <Pressable
              key={option.id}
              style={[styles.pill, selected && styles.pillSelected]}
              onPress={() => {
                if (single) {
                  onChange([option.id]);
                } else if (selected) {
                  onChange(selectedIds.filter((id) => id !== option.id));
                } else {
                  onChange([...selectedIds, option.id]);
                }
              }}
            >
              <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>Fecha</Text>
      <TextInput
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={value}
        onChangeText={onChange}
      />
    </View>
  );
}

function AppointmentCard({
  cita,
  primaryLabel,
  secondaryLabel,
  title,
  onPrimary,
  onSecondary,
  compact,
}: {
  cita: Cita;
  compact?: boolean;
  primaryLabel: string;
  secondaryLabel: string;
  title: string;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <View style={[styles.appointmentCard, compact && styles.fullWidthCard]}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardText}>{cita.procedimientos.map((item) => item.nombre).join(', ')}</Text>
      <Text style={styles.cardText}>{formatMoney(cita.costoTotal)}</Text>
      <Text style={styles.cardText}>
        {formatShortDate(cita.fecha)} - {cita.horaInicio} - {cita.horaFin}
      </Text>
      <Text style={styles.status}>{cita.estadoLabel}</Text>
      <View style={styles.cardActions}>
        <Pressable style={styles.smallButton} onPress={onPrimary}>
          <Text style={styles.smallButtonText}>{primaryLabel}</Text>
        </Pressable>
        <Pressable style={styles.ghostButton} onPress={onSecondary}>
          <Text style={styles.ghostButtonText}>{secondaryLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Avatar({ source, size }: { source: string | null; size: number }) {
  return (
    <Image
      source={source ? { uri: source } : avatar}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      resizeMode="cover"
    />
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
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
    backgroundColor: colors.black,
    borderRadius: 8,
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 18,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  badgeCompact: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  primaryAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.gold,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
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
  sectionTitle: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 26,
    marginBottom: 12,
    marginTop: 10,
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
  horizontalList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 14,
  },
  slotCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 210,
    padding: 14,
    flexGrow: 1,
    flexBasis: 210,
    alignSelf: 'flex-start',
  },
  barberCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 7,
    minWidth: 210,
    padding: 16,
    flexGrow: 1,
    flexBasis: 240,
  },
  appointmentCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 260,
    padding: 16,
    flexGrow: 1,
    flexBasis: 280,
  },
  fullWidthCard: {
    width: '100%',
    minWidth: '100%',
    flexBasis: '100%',
  },
  avatar: {
    backgroundColor: colors.softGold,
  },
  cardTitle: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 21,
    marginTop: 8,
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
  status: {
    alignSelf: 'flex-start',
    backgroundColor: colors.softGold,
    borderRadius: 8,
    color: colors.darkGold,
    fontFamily: fonts.medium,
    fontSize: 18,
    marginTop: 8,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  smallButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.black,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  reserveButton: {
    marginTop: 8,
  },
  smallButtonText: {
    color: colors.white,
    fontFamily: fonts.title,
    fontSize: 16,
  },
  ghostButton: {
    alignSelf: 'flex-start',
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
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(17,17,17,0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    backgroundColor: colors.white,
    borderRadius: 8,
    maxHeight: '92%',
    maxWidth: 680,
    padding: 20,
    width: '100%',
  },
  modalScrollContent: {
    paddingBottom: 12,
  },
  modalTitle: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 28,
    marginBottom: 12,
  },
  fieldBlock: {
    marginBottom: 12,
  },
  fieldLabel: {
    color: colors.black,
    fontFamily: fonts.medium,
    fontSize: 19,
    marginBottom: 7,
  },
  input: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.black,
    fontFamily: fonts.medium,
    fontSize: 19,
    minHeight: 48,
    paddingHorizontal: 12,
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
  total: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 21,
    marginBottom: 8,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.medium,
    fontSize: 18,
    marginBottom: 8,
  },
  readonlyBox: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
    padding: 12,
  },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  secondaryAction: {
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryActionText: {
    color: colors.darkGold,
    fontFamily: fonts.title,
    fontSize: 17,
  },
  modalSubmit: {
    backgroundColor: colors.gold,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalSubmitText: {
    color: colors.white,
    fontFamily: fonts.title,
    fontSize: 17,
  },
});
