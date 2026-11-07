import { Platform } from "react-native";

export interface PaymentReturn {
  idCita: string;
}

export function hasPaymentReturn(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("pago") === "resultado" && isUuid(params.get("idCita"));
}

export function readPaymentReturn(): PaymentReturn | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const idCita = params.get("idCita");
  if (params.get("pago") !== "resultado" || !isUuid(idCita)) return null;

  // Quita los datos de retorno de la barra de direcciones sin recargar la SPA.
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.hash}`,
  );
  return { idCita };
}

export function buildPaymentResponseUrl(
  responseUrl: string,
  idCita: string,
): string {
  const url = new URL(responseUrl);
  url.searchParams.set("pago", "resultado");
  url.searchParams.set("idCita", idCita);
  return url.toString();
}

export function submitPayuCheckout(
  action: string,
  fields: Record<string, string>,
): void {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    throw new Error(
      "El checkout en línea está disponible desde la Agenda web.",
    );
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.style.display = "none";
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

function isUuid(value: string | null): value is string {
  return (
    !!value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
