import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppShell } from './src/components/AppShell';
import api, {
  getAccessToken,
  restoreSession,
  setSession,
  setSessionExpiredHandler,
} from './src/api';
import { AdminHomeScreen } from './src/screens/AdminHome';
import { AgendaScreen } from './src/screens/Agenda';
import { ForgotPasswordScreen } from './src/screens/ForgotPassword';
import { HomeScreen } from './src/screens/Home';
import { LoginScreen } from './src/screens/Login';
import { PerfilScreen } from './src/screens/Perfil';
import { RegisterScreen } from './src/screens/Register';
import { RegisterBarberiaScreen } from './src/screens/RegisterBarberia';
import { ResetPasswordScreen } from './src/screens/ResetPassword';
import { colors, fonts } from './src/theme';
import type { AppScreen, Role, Screen, SessionProfile } from './src/types';
import { clearRecoveryToken, readRecoveryToken } from './src/utils/recoveryLink';

const logo = require('./assets/icon.png');

export default function App() {
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

  if (screen === 'home' || screen === 'agenda' || screen === 'perfil') {
    const appScreen = screen as AppScreen;
    const activeRole = profile?.role ?? role;

    return (
      <AppShell
        activeScreen={appScreen}
        brandName={profile?.barberia?.nombre ?? 'EdgeTimer'}
        role={activeRole}
        onLogout={handleLogout}
        onNavigate={(nextScreen) => {
          // El perfil propio se abre sin barbero seleccionado.
          if (nextScreen === 'perfil') setBarberoId(undefined);
          setScreen(nextScreen);
        }}
      >
        {appScreen === 'home' ? (
          activeRole === 'admin' ? (
            <AdminHomeScreen profile={profile} />
          ) : (
            <HomeScreen
              profile={profile}
              role={activeRole}
              onViewBarbero={(id) => {
                setBarberoId(id);
                setScreen('perfil');
              }}
            />
          )
        ) : appScreen === 'agenda' ? (
          <AgendaScreen profile={profile} role={activeRole} />
        ) : (
          <PerfilScreen
            profile={profile}
            role={activeRole}
            barberoId={barberoId}
            onAccountDeleted={() => endSession('Tu cuenta fue eliminada.')}
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
  title: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 38,
    marginBottom: 28,
    textAlign: 'center',
  },
});
