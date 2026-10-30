import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppShell } from './src/components/AppShell';
import api, {
  API_URL,
  getAccessToken,
  restoreSession,
  setSession,
  setSessionExpiredHandler,
} from './src/api';
import { AdminHomeScreen } from './src/screens/AdminHome';
import { AgendaScreen } from './src/screens/Agenda';
import { BarberoAgendaScreen } from './src/screens/barbero/BarberoAgenda';
import { BarberoDisponibilidadScreen } from './src/screens/barbero/BarberoDisponibilidad';
import { BarberoHomeScreen } from './src/screens/barbero/BarberoHome';
import { ChangePasswordScreen } from './src/screens/ChangePassword';
import { ForgotPasswordScreen } from './src/screens/ForgotPassword';
import { AgendarCitaScreen } from './src/screens/cliente/AgendarCita';
import { ClienteInicioScreen } from './src/screens/cliente/ClienteInicio';
import { LoginScreen } from './src/screens/Login';
import { PerfilScreen } from './src/screens/Perfil';
import { RegisterScreen } from './src/screens/Register';
import { RegisterBarberiaScreen } from './src/screens/RegisterBarberia';
import { ResetPasswordScreen } from './src/screens/ResetPassword';
import { colors, fonts } from './src/theme';
import type { AppScreen, BarberoElegido, Role, Screen, SessionProfile } from './src/types';
import { clearRecoveryToken, readRecoveryToken } from './src/utils/recoveryLink';

const logo = require('./assets/icon.png');

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  // Si la web se abre desde el enlace del correo, empieza en "nueva contraseña".
  const [recoveryToken, setRecoveryToken] = useState<string | null>(readRecoveryToken);
  // Mientras se intenta recuperar la sesión guardada se muestra un cargando
  // (así no parpadea la pantalla de login). Se omite si llega un enlace de recuperación.
  const [restoring, setRestoring] = useState(() => !readRecoveryToken());
  const [screen, setScreen] = useState<Screen>(() =>
    readRecoveryToken() ? 'resetPassword' : 'login',
  );
  const [role, setRole] = useState<Role>('cliente');
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [barberoId, setBarberoId] = useState<string | undefined>();
  // Barbero con el que el cliente está agendando (asistente de citas).
  const [agendando, setAgendando] = useState<BarberoElegido | null>(null);
  const [feedback, setFeedback] = useState('');
  const [fontsLoaded] = useFonts({
    Satoshi: require('./assets/fonts/Satoshi-Variable.ttf'),
    SatoshiItalic: require('./assets/fonts/Satoshi-VariableItalic.ttf'),
    DarkerGrotesqueLight: require('./assets/fonts/DarkerGrotesque-Light.ttf'),
    DarkerGrotesqueMedium: require('./assets/fonts/DarkerGrotesque-Medium.ttf'),
  });

  const title = useMemo(() => {
    if (screen === 'login') return 'Iniciar Sesión';
    if (screen === 'register') return 'Crear cuenta';
    if (screen === 'registerBarberia') return 'Registrar mi barbería';
    if (screen === 'forgotPassword') return 'Recuperar contraseña';
    if (screen === 'resetPassword') return 'Nueva contraseña';
    return '';
  }, [screen]);

  /** Deja la app en la pantalla de login, sin sesión, con un mensaje opcional. */
  const endSession = (message = '') => {
    setSession(null);
    setProfile(null);
    setBarberoId(undefined);
    setAgendando(null);
    setRole('cliente');
    setFeedback(message);
    setScreen('login');
  };

  // Si el token no se puede renovar, el interceptor de api.ts avisa aquí.
  useEffect(() => {
    setSessionExpiredHandler(() => endSession('Tu sesión expiró. Inicia sesión de nuevo.'));
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    if (!restoring) return;

    restoreSession()
      .then((restored) => {
        if (restored) handleLoginSuccess(restored);
      })
      .finally(() => setRestoring(false));
  }, []);

  const goTo = (next: Screen) => {
    setFeedback('');
    if (next !== 'resetPassword') {
      // Salir de la pantalla de recuperación descarta el token de la URL.
      clearRecoveryToken();
      setRecoveryToken(null);
    }
    setScreen(next);
  };

  const handleLoginSuccess = (nextProfile: SessionProfile) => {
    setProfile(nextProfile);
    setRole(nextProfile.role);
    setBarberoId(undefined);
    setAgendando(null);
    setFeedback('');
    setScreen('home');
  };

  const handleLogout = () => {
    // Se invalida el token en el servidor sin esperar la respuesta.
    const token = getAccessToken();
    if (token) {
      api
        .post('/auth/logout', null, { headers: { Authorization: `Bearer ${token}` } })
        .catch(() => undefined);
    }
    endSession();
  };

  if (!fontsLoaded || restoring) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={colors.gold} />
      </SafeAreaView>
    );
  }

  // Cuenta creada por un administrador: antes de usar la app debe elegir su contraseña.
  if (profile?.debeCambiarContrasena) {
    return (
      <AuthLayout title="Crea tu contraseña">
        <ChangePasswordScreen
          profile={profile}
          onDone={(next) => setProfile(next)}
          onLogout={handleLogout}
        />
      </AuthLayout>
    );
  }

  if (
    screen === 'home' ||
    screen === 'agenda' ||
    screen === 'disponibilidad' ||
    screen === 'perfil'
  ) {
    const activeRole = profile?.role ?? role;
    // La pantalla de disponibilidad solo existe para barberos.
    const appScreen: AppScreen =
      screen === 'disponibilidad' && activeRole !== 'barbero' ? 'home' : (screen as AppScreen);

    return (
      <AppShell
        activeScreen={appScreen}
        brandName={profile?.barberia?.nombre ?? 'EdgeTimer'}
        role={activeRole}
        onLogout={handleLogout}
        onNavigate={(nextScreen) => {
          // El perfil propio se abre sin barbero seleccionado.
          if (nextScreen === 'perfil') setBarberoId(undefined);
          // Volver a Home cancela el agendamiento en curso.
          if (nextScreen === 'home') setAgendando(null);
          setScreen(nextScreen);
        }}
      >
        {appScreen === 'home' ? (
          activeRole === 'admin' ? (
            <AdminHomeScreen profile={profile} />
          ) : activeRole === 'barbero' ? (
            <BarberoHomeScreen profile={profile} onNavigate={setScreen} />
          ) : agendando ? (
            <AgendarCitaScreen
              barbero={agendando}
              onBack={() => setAgendando(null)}
              onDone={() => setAgendando(null)}
            />
          ) : (
            <ClienteInicioScreen
              profile={profile}
              onViewBarbero={(id) => {
                setBarberoId(id);
                setScreen('perfil');
              }}
              onAgendar={setAgendando}
            />
          )
        ) : appScreen === 'agenda' ? (
          activeRole === 'barbero' ? (
            <BarberoAgendaScreen />
          ) : (
            <AgendaScreen profile={profile} role={activeRole} />
          )
        ) : appScreen === 'disponibilidad' ? (
          <BarberoDisponibilidadScreen />
        ) : (
          <PerfilScreen
            profile={profile}
            role={activeRole}
            barberoId={barberoId}
            onAccountDeleted={() => endSession('Tu cuenta fue eliminada.')}
            onAgendar={(barbero) => {
              setAgendando(barbero);
              setBarberoId(undefined);
              setScreen('home');
            }}
            onBack={() => {
              setBarberoId(undefined);
              setScreen('home');
            }}
            onProfileUpdate={(nextProfile) => setProfile(nextProfile)}
          />
        )}
      </AppShell>
    );
  }

  return <AuthLayout title={title}>
          {screen === 'login' && (
            <LoginScreen
              feedback={feedback}
              onFeedback={setFeedback}
              onLoginSuccess={handleLoginSuccess}
              onForgotPassword={() => goTo('forgotPassword')}
              onRegister={() => goTo('register')}
              onRegisterBarberia={() => goTo('registerBarberia')}
            />
          )}

          {screen === 'register' && (
            <RegisterScreen
              feedback={feedback}
              onFeedback={setFeedback}
              onBackToLogin={() => goTo('login')}
              onRegistered={() => {
                setFeedback('Registro exitoso. Ahora inicia sesión.');
                setScreen('login');
              }}
            />
          )}

          {screen === 'registerBarberia' && (
            <RegisterBarberiaScreen
              feedback={feedback}
              onFeedback={setFeedback}
              onBackToLogin={() => goTo('login')}
              onRegistered={() => {
                setFeedback('Registro exitoso. Ahora inicia sesión con tu cuenta de administrador.');
                setScreen('login');
              }}
            />
          )}

          {screen === 'forgotPassword' && (
            <ForgotPasswordScreen
              feedback={feedback}
              onFeedback={setFeedback}
              onBackToLogin={() => goTo('login')}
            />
          )}

          {screen === 'resetPassword' && (
            <ResetPasswordScreen
              feedback={feedback}
              tokenHash={recoveryToken ?? ''}
              onFeedback={setFeedback}
              onBackToLogin={() => goTo('login')}
              onDone={(message) => {
                clearRecoveryToken();
                setRecoveryToken(null);
                setFeedback(message);
                setScreen('login');
              }}
            />
          )}
    </AuthLayout>;
}

/** Estructura común de las pantallas sin sesión: logo, título y contenido. */
function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Image source={logo} style={styles.logo} />
          <Text style={styles.title}>{title}</Text>
          {/* Solo en desarrollo: muestra a qué backend está hablando la app. */}
          {__DEV__ ? <Text style={styles.devServer}>Servidor: {API_URL}</Text> : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  logo: {
    width: 118,
    height: 118,
    borderRadius: 28,
    marginBottom: 22,
  },
  devServer: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 14,
    marginBottom: 16,
    marginTop: -16,
  },
  title: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 38,
    marginBottom: 28,
    textAlign: 'center',
  },
});
