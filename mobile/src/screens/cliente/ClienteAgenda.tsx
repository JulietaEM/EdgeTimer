import { useCallback, useEffect, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import api from "../../api";
import { PropuestaBanner } from "../../components/PropuestaBanner";
import { colors, fonts } from "../../theme";
import type { CitaCliente, CitasClienteResultado } from "../../types";
import { readError } from "../../utils/errors";
import { formatMoney, formatShortDate } from "../../utils/format";
import {
  buildPaymentResponseUrl,
  readPaymentReturn,
  submitPayuCheckout,
} from "../../utils/payuCheckout";
import {
  CalificarModal,
  CancelarModal,
  ReprogramarModal,
} from "./ClienteCitaModals";

type Tab = "proximas" | "historial";

const PAGE = 20;
const avatar = require("../../../assets/user.png");

// Agenda del cliente: próximas citas (cancelar, reprogramar y responder propuestas
// del barbero) e historial (realizadas, canceladas y rechazadas, con la opción de
// calificar las realizadas).
export function ClienteAgendaScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 620;
  const [tab, setTab] = useState<Tab>("proximas");
  const [citas, setCitas] = useState<CitaCliente[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [cancelando, setCancelando] = useState<CitaCliente | null>(null);
  const [reprogramando, setReprogramando] = useState<CitaCliente | null>(null);
  const [calificando, setCalificando] = useState<CitaCliente | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [paymentBusyId, setPaymentBusyId] = useState<string | null>(null);
  const [paymentStates, setPaymentStates] = useState<
    Record<string, string | null>
  >({});
  const [paymentReturnMessage, setPaymentReturnMessage] = useState("");

  const load = useCallback(async (current: Tab, offset = 0) => {
    setError("");
    try {
      const response = await api.get<CitasClienteResultado>("/cliente/citas", {
        params: { grupo: current, offset, limit: PAGE },
      });
      setCitas((previous) =>
        offset === 0
          ? response.data.items
          : [...previous, ...response.data.items],
      );
      if (offset === 0) {
        const confirmed = response.data.items.filter(
          (cita) => cita.estado === "confirmada",
        );
        const statuses = await Promise.all(
          confirmed.map(async (cita) => {
            try {
              const result = await api.get(`/pagos/citas/${cita.id}`);
              return [cita.id, result.data.pago?.estado ?? null] as const;
            } catch {
              return [cita.id, "desconocido"] as const;
            }
          }),
        );
        setPaymentStates(Object.fromEntries(statuses));
      }
      setHayMas(response.data.hayMas);
    } catch (err) {
      setError(readError(err, "No fue posible cargar tus citas."));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setCitas([]);
    setHayMas(false);
    load(tab);
  }, [tab, load]);

  useEffect(() => {
    const paymentReturn = readPaymentReturn();
    if (!paymentReturn) return;
    let active = true;
    api
      .get(`/pagos/citas/${paymentReturn.idCita}`)
      .then(({ data }) => {
        if (!active) return;
        const state = data.pago?.estado ?? "sin_pago";
        const messages: Record<string, string> = {
          aprobado: "Pago aprobado. Tu cita aparece como pagada.",
          pendiente:
            "El pago sigue pendiente. Actualizaremos el estado cuando PayU lo confirme.",
          rechazado:
            "PayU rechazó el pago. Puedes intentarlo de nuevo desde la cita.",
          expirado:
            "El intento de pago venció. Puedes iniciar otro desde la cita.",
          error:
            "No se pudo confirmar el pago. Consulta de nuevo en unos minutos.",
          sin_pago:
            "No encontramos un pago para esta cita. Puedes volver a intentarlo desde la Agenda.",
        };
        setPaymentReturnMessage(
          messages[state] ?? "Estado del pago actualizado desde el servidor.",
        );
        setPaymentStates((previous) => ({
          ...previous,
          [paymentReturn.idCita]: data.pago?.estado ?? null,
        }));
      })
      .catch((err) => {
        if (active)
          setPaymentReturnMessage(
            readError(err, "No se pudo consultar el estado del pago."),
          );
      })
      .finally(() => {
        if (active) {
          setTab("proximas");
          load("proximas");
        }
      });
    return () => {
      active = false;
    };
  }, [load]);

  const startPayment = async (cita: CitaCliente) => {
    setPaymentBusyId(cita.id);
    try {
      const { data } = await api.post(`/pagos/citas/${cita.id}/checkout`);
      const fields = {
        ...data.checkout.fields,
        responseUrl: buildPaymentResponseUrl(
          data.checkout.fields.responseUrl,
          cita.id,
        ),
      };
      submitPayuCheckout(data.checkout.action, fields);
    } catch (err) {
      showToast(readError(err, "No fue posible iniciar el pago."));
      setPaymentBusyId(null);
    }
  };

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 3500);
  };

  const done = (message: string) => {
    setCancelando(null);
    setReprogramando(null);
    setCalificando(null);
    showToast(message);
    load(tab);
  };

  const respond = async (
    cita: CitaCliente,
    action: "aceptar" | "rechazar" | "retirar",
  ) => {
    setBusyId(cita.id);
    try {
      const response = await api.patch(
        `/cliente/citas/${cita.id}/propuesta/${action}`,
      );
      showToast(response.data.message);
    } catch (err) {
      showToast(readError(err, "No fue posible responder a la propuesta."));
    } finally {
      setBusyId(null);
      load(tab);
    }
  };

  const loadMore = () => {
    setLoadingMore(true);
    load(tab, citas.length);
  };

  return (
    <View>
      <Text style={styles.kicker}>Agenda cliente</Text>
      <Text style={styles.title}>Mis citas</Text>

      <View style={styles.tabs}>
        <TabButton
          active={tab === "proximas"}
          label="Próximas"
          onPress={() => setTab("proximas")}
        />
        <TabButton
          active={tab === "historial"}
          label="Historial"
          onPress={() => setTab("historial")}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {paymentReturnMessage ? (
        <View style={styles.paymentNotice}>
          <Text style={styles.paymentNoticeText}>{paymentReturnMessage}</Text>
          <Pressable onPress={() => setPaymentReturnMessage("")}>
            <Text style={styles.paymentNoticeClose}>Cerrar</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <Text style={styles.empty}>Cargando tus citas...</Text>
      ) : citas.length === 0 && !error ? (
        <Text style={styles.empty}>
          {tab === "proximas"
            ? "No tienes citas próximas. Agenda una desde el Home eligiendo a tu barbero."
            : "Aún no tienes citas en tu historial."}
        </Text>
      ) : (
        <View style={styles.list}>
          {citas.map((cita) => (
            <CitaCard
              key={cita.id}
              cita={cita}
              compact={isCompact}
              busy={busyId === cita.id}
              historial={tab === "historial"}
              paymentState={paymentStates[cita.id]}
              paymentBusy={paymentBusyId === cita.id}
              onPay={() => startPayment(cita)}
              onAcceptProposal={() => respond(cita, "aceptar")}
              onCancel={() => setCancelando(cita)}
              onRate={() => setCalificando(cita)}
              onRejectProposal={() => respond(cita, "rechazar")}
              onReprogram={() => setReprogramando(cita)}
              onWithdrawProposal={() => respond(cita, "retirar")}
            />
          ))}
        </View>
      )}

      {tab === "historial" && hayMas ? (
        <Pressable
          disabled={loadingMore}
          style={styles.moreButton}
          onPress={loadMore}
        >
          <Text style={styles.moreText}>
            {loadingMore ? "Cargando..." : "Ver más"}
          </Text>
        </Pressable>
      ) : null}

      <CancelarModal
        cita={cancelando}
        onClose={() => setCancelando(null)}
        onDone={done}
      />
      <ReprogramarModal
        cita={reprogramando}
        onClose={() => setReprogramando(null)}
        onDone={done}
      />
      <CalificarModal
        cita={calificando}
        onClose={() => setCalificando(null)}
        onDone={done}
      />

      {toast ? <Text style={styles.toast}>{toast}</Text> : null}
    </View>
  );
}

function TabButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.tab, active && styles.tabActive]}
      onPress={onPress}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function CitaCard({
  cita,
  compact,
  busy,
  historial,
  paymentState,
  paymentBusy,
  onPay,
  onAcceptProposal,
  onCancel,
  onRate,
  onRejectProposal,
  onReprogram,
  onWithdrawProposal,
}: {
  cita: CitaCliente;
  compact: boolean;
  busy: boolean;
  historial: boolean;
  paymentState: string | null | undefined;
  paymentBusy: boolean;
  onPay: () => void;
  onAcceptProposal: () => void;
  onCancel: () => void;
  onRate: () => void;
  onRejectProposal: () => void;
  onReprogram: () => void;
  onWithdrawProposal: () => void;
}) {
  const blocked = !cita.puedeModificar || !!cita.propuesta?.puedeResponder;

  return (
    <View style={[styles.card, compact && styles.fullWidth]}>
      <View style={styles.barberRow}>
        <Image
          source={cita.barbero.foto ? { uri: cita.barbero.foto } : avatar}
          style={styles.avatar}
          resizeMode="cover"
        />
        <View style={styles.barberText}>
          <Text style={styles.cardTitle}>{cita.barbero.nombre}</Text>
          <Text style={styles.cardText}>{cita.barberia.nombre}</Text>
        </View>
      </View>

      <Text style={styles.cardText}>
        {cita.procedimientos.map((item) => item.nombre).join(", ")}
      </Text>
      <Text style={styles.cardText}>
        {formatMoney(cita.costoTotal)} · {cita.duracionMinutos} min
      </Text>
      <Text style={styles.when}>
        {formatShortDate(cita.fecha)} · {cita.horaInicio} - {cita.horaFin}
      </Text>
      <Text style={styles.status}>{cita.estadoLabel}</Text>
      {cita.estado === "confirmada" && paymentState === "aprobado" ? (
        <Text style={styles.paidBadge}>Pagada</Text>
      ) : null}
      {cita.estado === "confirmada" && paymentState === "desconocido" ? (
        <Text style={styles.help}>
          No pudimos consultar el estado del pago. Recarga la Agenda para volver
          a intentarlo.
        </Text>
      ) : null}
      {cita.motivo && historial ? (
        <Text style={styles.note}>Motivo: {cita.motivo}</Text>
      ) : null}
      {cita.propuesta ? (
        <PropuestaBanner
          busy={busy}
          otraParte={cita.barbero.nombre}
          propuesta={cita.propuesta}
          onAccept={onAcceptProposal}
          onReject={onRejectProposal}
          onWithdraw={onWithdrawProposal}
        />
      ) : null}
      {cita.notas ? <Text style={styles.note}>“{cita.notas}”</Text> : null}

      {historial ? (
        cita.calificacion ? (
          <View style={styles.rated}>
            <Text style={styles.ratedStars}>
              {"★".repeat(cita.calificacion.puntuacion)}
              <Text style={styles.ratedOff}>
                {"★".repeat(5 - cita.calificacion.puntuacion)}
              </Text>
            </Text>
            {cita.calificacion.resena ? (
              <Text style={styles.cardText}>“{cita.calificacion.resena}”</Text>
            ) : null}
          </View>
        ) : cita.puedeCalificar ? (
          <View style={styles.actions}>
            <Pressable style={styles.primary} onPress={onRate}>
              <Text style={styles.primaryText}>Calificar esta cita</Text>
            </Pressable>
          </View>
        ) : null
      ) : (
        <View>
          {Platform.OS === "web" &&
          cita.estado === "confirmada" &&
          paymentState !== undefined &&
          paymentState !== "aprobado" &&
          paymentState !== "desconocido" ? (
            <View style={styles.actions}>
              <Pressable
                disabled={paymentBusy || paymentState === undefined}
                style={[
                  styles.payButton,
                  (paymentBusy || paymentState === undefined) &&
                    styles.disabled,
                ]}
                onPress={onPay}
              >
                <Text style={styles.primaryText}>
                  {paymentBusy ? "Conectando con PayU..." : "Pagar ahora"}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              disabled={blocked}
              style={[styles.primary, blocked && styles.disabled]}
              onPress={onReprogram}
            >
              <Text style={styles.primaryText}>Reprogramar</Text>
            </Pressable>
            <Pressable
              disabled={!cita.puedeModificar}
              style={[styles.ghost, !cita.puedeModificar && styles.disabled]}
              onPress={onCancel}
            >
              <Text style={styles.ghostText}>Cancelar</Text>
            </Pressable>
          </View>
          {!cita.puedeModificar ? (
            <Text style={styles.help}>
              Solo puedes cancelar o reprogramar citas con al menos 1 día de
              antelación.
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { color: colors.darkGold, fontFamily: fonts.medium, fontSize: 21 },
  title: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 36,
    marginBottom: 12,
  },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  tab: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  tabActive: { backgroundColor: colors.black, borderColor: colors.black },
  tabText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18 },
  tabTextActive: { color: colors.white },
  empty: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 20,
    marginBottom: 20,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.medium,
    fontSize: 18,
    marginBottom: 12,
  },
  list: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 300,
    flexGrow: 1,
    gap: 6,
    maxWidth: 520,
    minWidth: 260,
    padding: 16,
  },
  fullWidth: { maxWidth: "100%", minWidth: "100%", width: "100%" },
  barberRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 4,
  },
  avatar: {
    backgroundColor: colors.softGold,
    borderRadius: 24,
    height: 48,
    width: 48,
  },
  barberText: { flex: 1, minWidth: 0 },
  cardTitle: { color: colors.black, fontFamily: fonts.title, fontSize: 21 },
  cardText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18 },
  when: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 20,
    marginTop: 4,
  },
  status: {
    alignSelf: "flex-start",
    backgroundColor: colors.softGold,
    borderRadius: 8,
    color: colors.darkGold,
    fontFamily: fonts.medium,
    fontSize: 18,
    marginTop: 6,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  note: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 17,
    marginTop: 4,
  },
  rated: { gap: 2, marginTop: 8 },
  ratedStars: { color: colors.gold, fontSize: 24 },
  ratedOff: { color: colors.border },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  primary: {
    backgroundColor: colors.black,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  primaryText: { color: colors.white, fontFamily: fonts.title, fontSize: 16 },
  ghost: {
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  ghostText: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 16 },
  disabled: { opacity: 0.45 },
  help: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 16,
    marginTop: 6,
  },
  moreButton: {
    alignSelf: "center",
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  moreText: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 17 },
  toast: {
    alignSelf: "center",
    backgroundColor: colors.black,
    borderRadius: 8,
    bottom: 16,
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 18,
    overflow: "hidden",
    paddingHorizontal: 18,
    paddingVertical: 10,
    position: "absolute",
  },
  payButton: {
    backgroundColor: colors.darkGold,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  paidBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#e5f4ea",
    borderRadius: 8,
    color: "#23683c",
    fontFamily: fonts.medium,
    fontSize: 16,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  paymentNotice: {
    alignItems: "center",
    backgroundColor: colors.softGold,
    borderRadius: 8,
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
    marginBottom: 16,
    padding: 14,
  },
  paymentNoticeText: {
    color: colors.black,
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 17,
  },
  paymentNoticeClose: {
    color: colors.darkGold,
    fontFamily: fonts.title,
    fontSize: 16,
  },
});
