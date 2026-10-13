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
  userIcon,
  phoneIcon,
} from '../components/FormControls';
import { PolicyModal } from '../components/PolicyModal';
import { colors, fonts } from '../theme';
import { readError } from '../utils/errors';

export function RegisterBarberiaScreen({
  feedback,
  onFeedback,
  onBackToLogin,
  onRegistered,
}: {
  feedback: string;
  onFeedback: (message: string) => void;
  onBackToLogin: () => void;
  onRegistered: () => void;
}) {
  const [nombreBarberia, setNombreBarberia] = useState('');
  const [direccion, setDireccion] = useState('');
  const [telefonoBarberia, setTelefonoBarberia] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [nombreAdmin, setNombreAdmin] = useState('');
  const [email, setEmail] = useState('');
  const [telefonoAdmin, setTelefonoAdmin] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (password !== confirm) {
      onFeedback('Las contraseñas no coinciden.');
      return;
    }
    if (!accepted) {
      onFeedback('Debes aceptar la política de tratamiento de datos personales.');
      return;
    }

    setLoading(true);
    onFeedback('');

    try {
      await api.post('/auth/register-barberia', {
        barberia: {
          nombre: nombreBarberia,
          direccion,
          telefono: telefonoBarberia,
          descripcion,
        },
        admin: {
          nombre: nombreAdmin,
          email,
          telefono: telefonoAdmin,
          password,
        },
        aceptaTerminos: accepted,
      });
      onRegistered();
    } catch (error) {
      onFeedback(readError(error, 'No fue posible registrar la barbería'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={formStyles.form}>
      <Text style={styles.section}>Datos de la barbería</Text>
      <Input
        icon={userIcon}
        placeholder="Nombre de la barbería"
        value={nombreBarberia}
        onChangeText={setNombreBarberia}
      />
      <Input placeholder="Dirección (opcional)" value={direccion} onChangeText={setDireccion} />
      <Input
        icon={phoneIcon}
        placeholder="Teléfono de la barbería (opcional)"
        value={telefonoBarberia}
        onChangeText={setTelefonoBarberia}
        keyboardType="phone-pad"
      />
      <Input
        placeholder="Descripción (opcional)"
        value={descripcion}
        onChangeText={setDescripcion}
      />

      <Text style={styles.section}>Tus datos como administrador</Text>
      <Input icon={userIcon} placeholder="Tu nombre" value={nombreAdmin} onChangeText={setNombreAdmin} />
      <Input
        icon={userIcon}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <Input
        icon={phoneIcon}
        placeholder="Tu teléfono (opcional)"
        value={telefonoAdmin}
        onChangeText={setTelefonoAdmin}
        keyboardType="phone-pad"
      />
      <Input
        icon={keyIcon}
        placeholder="Contraseña (8+ caracteres, letras y números)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Input
        icon={keyIcon}
        placeholder="Confirmar contraseña"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
      />

      <Checkbox checked={accepted} onToggle={() => setAccepted((value) => !value)}>
        <Text style={styles.terms}>
          Acepto la{' '}
          <Pressable onPress={() => setPolicyOpen(true)}>
            <Text style={styles.termsLink}>política de tratamiento de datos personales</Text>
          </Pressable>
        </Text>
      </Checkbox>

      <Feedback message={feedback} />
      <PrimaryButton label="Registrar mi barbería" onPress={submit} loading={loading} />
      <InlineLink prefix="¿Ya tienes cuenta?" label="Iniciar Sesión" onPress={onBackToLogin} />
      <PolicyModal open={policyOpen} onClose={() => setPolicyOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 22,
    marginTop: 6,
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
