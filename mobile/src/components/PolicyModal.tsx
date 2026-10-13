import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

// TEXTO DE EJEMPLO: reemplázalo por la política que apruebe tu equipo
// (Ley 1581 de 2012, Habeas Data). Si cambias el texto, sube TERMS_VERSION
// en el backend para saber qué versión aceptó cada usuario.
const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Responsable del tratamiento',
    body: 'EdgeTimer es un proyecto académico del Tecnológico de Antioquia Institución Universitaria. El equipo del proyecto es el responsable del tratamiento de tus datos personales.',
  },
  {
    title: 'Datos que recolectamos',
    body: 'Nombre, correo electrónico, teléfono (opcional), foto de perfil (opcional), historial de citas y calificaciones que registres.',
  },
  {
    title: 'Para qué los usamos',
    body: 'Crear y administrar tu cuenta, agendar y gestionar citas entre clientes y barberías, enviarte notificaciones sobre tus citas y generar reportes para la barbería donde agendas.',
  },
  {
    title: 'Tus derechos',
    body: 'Puedes conocer, actualizar y rectificar tus datos desde tu perfil, y solicitar su supresión eliminando tu cuenta. Al eliminarla, tu información personal se borra y tu historial de citas se conserva sin datos que te identifiquen.',
  },
  {
    title: 'Seguridad',
    body: 'Tu contraseña se almacena cifrada y cada usuario solo accede a la información que le corresponde según su rol.',
  },
];

export function PolicyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal animationType="fade" transparent visible={open} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Política de tratamiento de datos</Text>
          <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
            {SECTIONS.map((section) => (
              <View key={section.title} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.body}>{section.body}</Text>
              </View>
            ))}
          </ScrollView>
          <Pressable style={styles.button} onPress={onClose}>
            <Text style={styles.buttonText}>Entendido</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    maxWidth: 560,
    padding: 20,
    width: '100%',
  },
  title: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 26,
    marginBottom: 12,
  },
  scroll: {
    flexGrow: 0,
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.darkGold,
    fontFamily: fonts.title,
    fontSize: 18,
    marginBottom: 2,
  },
  body: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 17,
  },
  button: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: colors.gold,
    borderRadius: 8,
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  buttonText: {
    color: colors.white,
    fontFamily: fonts.title,
    fontSize: 17,
  },
});
