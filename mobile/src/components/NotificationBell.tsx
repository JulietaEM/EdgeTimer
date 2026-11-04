import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import api from '../api';
import {
  disableWebPush,
  enableWebPush,
  getPushState,
  onPushMessage,
  type PushState,
} from '../notifications/webPush';
import { colors, fonts } from '../theme';
import type { Notificacion } from '../types';
import { readError } from '../utils/errors';
import { formatAgo } from '../utils/format';

const POLL_MS = 30000;

const PUSH_HINT: Partial<Record<PushState, string>> = {
  unsupported: 'Este navegador no admite avisos del sistema. Los verás aquí.',
  unconfigured: 'Los avisos del navegador no están configurados. Los verás aquí.',
  denied:
    'Bloqueaste los avisos en este navegador. Para recibirlos, permítelos desde el candado de la barra de direcciones.',
};

/**
 * Campana de avisos: lista lo que pasó con tus citas (solicitudes, cambios,
 * recordatorios) y, en la versión web, deja activar los avisos del navegador.
 */
export function NotificationBell() {
  const [items, setItems] = useState<Notificacion[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [pushState, setPushState] = useState<PushState>('native');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await api.get('/notificaciones');
      setItems(response.data.items);
      setUnread(response.data.noLeidas);
    } catch {
      // Silencioso: el próximo sondeo vuelve a intentar.
    }
  }, []);

  useEffect(() => {
    void load();
    void getPushState().then(setPushState);

    const timer = setInterval(() => void load(), POLL_MS);
    const stopListening = onPushMessage(() => void load());

    return () => {
      clearInterval(timer);
      stopListening();
    };
  }, [load]);

  const openPanel = () => {
    setOpen(true);
    void load();
  };

  const markRead = async (item: Notificacion) => {
    if (item.leida) return;

    setItems((current) => current.map((n) => (n.id === item.id ? { ...n, leida: true } : n)));
    setUnread((count) => Math.max(0, count - 1));
    try {
      await api.patch(`/notificaciones/${item.id}/leer`);
    } catch {
      void load();
    }
  };

  const markAllRead = async () => {
    setItems((current) => current.map((n) => ({ ...n, leida: true })));
    setUnread(0);
    try {
      await api.post('/notificaciones/leer-todas');
    } catch {
      void load();
    }
  };

  const togglePush = async () => {
    setBusy(true);
    setError('');
    try {
      if (pushState === 'on') {
        await disableWebPush();
        setPushState('off');
      } else {
        setPushState(await enableWebPush());
      }
    } catch (err) {
      setError(readError(err, 'No fue posible cambiar los avisos del navegador.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable
        accessibilityLabel={`Avisos${unread ? `, ${unread} sin leer` : ''}`}
        onPress={openPanel}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>Avisos</Text>
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        ) : null}
      </Pressable>

      <Modal animationType="fade" transparent visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.card} onPress={() => undefined}>
            <View style={styles.cardHeader}>
              <Text style={styles.title}>Avisos</Text>
              {unread > 0 ? (
                <Pressable onPress={markAllRead}>
                  <Text style={styles.link}>Marcar todos como leídos</Text>
                </Pressable>
              ) : null}
            </View>

            {pushState !== 'native' ? (
              <View style={styles.pushBox}>
                {pushState === 'on' || pushState === 'off' ? (
                  <>
                    <Text style={styles.pushText}>
                      {pushState === 'on'
                        ? 'Avisos del navegador activados: te llegan aunque esta pestaña esté en segundo plano.'
                        : 'Activa los avisos del navegador para enterarte al instante.'}
                    </Text>
                    <Pressable
                      disabled={busy}
                      onPress={togglePush}
                      style={[styles.pushButton, pushState === 'on' && styles.pushButtonGhost, busy && styles.disabled]}
                    >
                      <Text style={[styles.pushButtonText, pushState === 'on' && styles.pushButtonTextGhost]}>
                        {pushState === 'on' ? 'Desactivar' : 'Activar'}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.pushText}>{PUSH_HINT[pushState]}</Text>
                )}
                {error ? <Text style={styles.error}>{error}</Text> : null}
              </View>
            ) : null}

            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {items.length === 0 ? (
                <Text style={styles.empty}>Aún no tienes avisos.</Text>
              ) : (
                items.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => markRead(item)}
                    style={[styles.item, !item.leida && styles.itemUnread]}
                  >
                    <View style={styles.itemTop}>
                      <Text style={styles.itemTitle}>{item.titulo}</Text>
                      <Text style={styles.itemTime}>{formatAgo(item.creadaAt)}</Text>
                    </View>
                    <Text style={styles.itemText}>{item.mensaje}</Text>
                  </Pressable>
                ))
              )}
            </ScrollView>

            <Pressable style={styles.close} onPress={() => setOpen(false)}>
              <Text style={styles.closeText}>Cerrar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  buttonText: { color: colors.darkGold, fontFamily: fonts.medium, fontSize: 18 },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderRadius: 10,
    justifyContent: 'center',
    minWidth: 20,
    paddingHorizontal: 5,
  },
  badgeText: { color: colors.white, fontFamily: fonts.title, fontSize: 13 },
  pressed: { opacity: 0.82 },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(17,17,17,0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 8,
    maxHeight: '88%',
    maxWidth: 520,
    padding: 20,
    width: '100%',
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { color: colors.black, fontFamily: fonts.title, fontSize: 28 },
  link: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 15 },
  pushBox: {
    backgroundColor: colors.background,
    borderRadius: 8,
    gap: 10,
    marginBottom: 12,
    padding: 12,
  },
  pushText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 16 },
  pushButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.gold,
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pushButtonGhost: { backgroundColor: colors.white },
  pushButtonText: { color: colors.white, fontFamily: fonts.title, fontSize: 16 },
  pushButtonTextGhost: { color: colors.darkGold },
  disabled: { opacity: 0.45 },
  error: { color: colors.danger, fontFamily: fonts.medium, fontSize: 16 },
  list: { flexGrow: 0 },
  empty: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18, paddingVertical: 16 },
  item: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    gap: 4,
    paddingVertical: 12,
  },
  itemUnread: { backgroundColor: colors.softGold, paddingHorizontal: 10 },
  itemTop: { flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  itemTitle: { color: colors.black, flex: 1, fontFamily: fonts.title, fontSize: 18 },
  itemTime: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15 },
  itemText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 17 },
  close: {
    alignSelf: 'flex-end',
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  closeText: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 17 },
});
