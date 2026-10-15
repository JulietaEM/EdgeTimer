import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import api from '../api';
import {
  Checkbox,
  Feedback,
  formStyles,
  InlineLink,
  Input,
  keyIcon,
  PrimaryButton,
} from '../components/FormControls';
import { PolicyModal } from '../components/PolicyModal';
import { colors, fonts } from '../theme';
import type { SessionProfile } from '../types';
import { readError } from '../utils/errors';

/**
 * Pantalla obligatoria del primer ingreso de una cuenta creada por un
 * administrador (barberos): cambiar la contraseña temporal y aceptar la
 * política de datos. No se puede saltar: solo se puede cerrar sesión.
 */
export function ChangePasswordScreen({
  profile,
  onDone,
  onLogout,
}: {
  profile: SessionProfile;
  onDone: (profile: SessionProfile) => void;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  const needsTerms = profile.terminosPendientes === true;

  const submit = async () => {
    if (password !== confirm) {
      setFeedback('Las contraseñas nuevas no coinciden.');
      return;
    }
    if (needsTerms && !accepted) {
      setFeedback('Debes aceptar la política de tratamiento de datos personales.');
      return;
    }

    setLoading(true);
    setFeedback('');

    try {
      const response = await api.post('/auth/me/password', {
        currentPassword: current,
        newPassword: password,
        aceptaTerminos: accepted,
      });
      onDone(response.data.profile as SessionProfile);
    } catch (error) {
      setFeedback(readError(error, 'No fue posible cambiar la contraseña.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={formStyles.form}>
      <Text style={styles.intro}>
        Hola, {profile.nombre}. Tu cuenta se creó con una contraseña temporal. Elige una propia
        para continuar.
      </Text>
      <Input
        icon={keyIcon}
        placeholder="Contraseña temporal"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
      />
      <Input
        icon={keyIcon}
        placeholder="Contraseña nueva (8+ caracteres, letras y números)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Input
        icon={keyIcon}
        placeholder="Confirmar contraseña nueva"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
      />
      {needsTerms ? (
        <Checkbox checked={accepted} onToggle={() => setAccepted((value) => !value)}>
          <Text style={styles.terms}>
            Acepto la{' '}
            <Pressable onPress={() => setPolicyOpen(true)}>
              <Text style={styles.termsLink}>política de tratamiento de datos personales</Text>
            </Pressable>
          </Text>
        </Checkbox>
      ) : null}
      <Feedback message={feedback} />
      <PrimaryButton label="Guardar y continuar" onPress={submit} loading={loading} />
      <InlineLink label="Cerrar sesión" onPress={onLogout} />
      <PolicyModal open={policyOpen} onClose={() => setPolicyOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  intro: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 18,
    textAlign: 'center',
  },
  terms: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 16,
  },
  termsLink: {
    color: colors.darkGold,
    fontFamily: fonts.title,
    fontSize: 16,
    textDecorationLine: 'underline',
  },
});
