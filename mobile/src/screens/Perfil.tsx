import { useEffect, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import api, { postForm } from '../api';
import { FormModal } from '../components/FormModal';
import { LabeledInput } from '../components/LabeledInput';
import { colors, fonts } from '../theme';
import type { Barbero, Role, SessionProfile } from '../types';
import { readError } from '../utils/errors';

const avatar = require('../../assets/user.png');

export function PerfilScreen({
  profile,
  role,
  barberoId,
  onAccountDeleted,
  onBack,
  onProfileUpdate,
}: {
  profile: SessionProfile | null;
  role: Role;
  barberoId?: string;
  onAccountDeleted: () => void;
  onBack: () => void;
  onProfileUpdate: (profile: SessionProfile) => void;
}) {
  const { width } = useWindowDimensions();
  const isCompact = width < 620;
  const [barbero, setBarbero] = useState<Barbero | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const loadBarbero = async () => {
    if (!barberoId) return;
    setLoading(true);
    setBarbero(null); // Reset antes de cargar
    try {
      const res = await api.get(`/catalogos/barberos/${barberoId}`);
      setBarbero(res.data);
    } catch (error: any) {
      setToast(error?.response?.data?.message || 'No fue posible cargar el perfil del barbero.');
      setBarbero(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (barberoId && barberoId.length > 0) {
      loadBarbero();
    } else {
      setBarbero(null);
    }
  }, [barberoId]);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 3500);
  };

  const createFormData = async (uri: string, name: string, type: string) => {
    const formData = new FormData();

    if (Platform.OS === 'web') {
      const response = await fetch(uri);
      const blob = await response.blob();
      const file = new File([blob], name, { type: blob.type || type });
      formData.append('photo', file);
      return formData;
    }

    formData.append('photo', { uri, name, type } as any);
    return formData;
  };

  const uploadPhoto = async (uri: string) => {
    if (!profile?.id) {
      showToast('No se encontró el perfil.');
      return;
    }

    setUploading(true);
    try {
      const { name, type } = describeImage(uri);
      const body = await createFormData(uri, name, type);
      const response = await postForm('/auth/me/foto', body);
      const uploadedUrl = response.data?.url;

      if (uploadedUrl) {
        onProfileUpdate({ ...profile, foto: uploadedUrl });
      }

      showToast('Foto subida correctamente.');
    } catch (error: any) {
      showToast(readError(error, error?.message || 'Error al subir la foto.'));
    } finally {
      setUploading(false);
    }
  };

  const formatRegistrationDate = (date?: string) => {
    if (!date) return 'No disponible';
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return date;
    return parsed.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const pickImage = async () => {
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast('Necesitamos permiso para acceder a las fotos.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });

    if (result.canceled || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    if (asset.uri) {
      await uploadPhoto(asset.uri);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, isCompact && styles.headerCompact]}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Atrás</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>{barberoId ? 'Perfil de Barbero' : 'Mi Perfil'}</Text>
          <Text style={styles.title}>{barberoId ? barbero?.nombre || 'Cargando...' : profile?.nombre || 'Tu Perfil'}</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {barberoId && loading ? (
          <Text style={styles.empty}>Cargando perfil de barbero...</Text>
        ) : barberoId && !barbero ? (
          <Text style={styles.empty}>No se pudo cargar el perfil del barbero.</Text>
        ) : barberoId && barbero ? (
          <BarberPerfilContent barbero={barbero} isCompact={isCompact} />
        ) : (
          <OwnProfile
            profile={profile}
            role={role}
            isCompact={isCompact}
            onDelete={() => setDeleteOpen(true)}
            onEdit={() => setEditOpen(true)}
            onChangePassword={() => setPasswordOpen(true)}
            onUploadPhoto={pickImage}
            uploading={uploading}
            formatRegistrationDate={formatRegistrationDate}
          />
        )}
      </ScrollView>

      <EditProfileModal
        open={editOpen}
        profile={profile}
        onClose={() => setEditOpen(false)}
        onSaved={(next, message) => {
          onProfileUpdate(next);
          setEditOpen(false);
          showToast(message);
        }}
      />

      <ChangePasswordModal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onSaved={(message) => {
          setPasswordOpen(false);
          showToast(message);
        }}
      />

      <DeleteAccountModal
        open={deleteOpen}
        role={role}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onAccountDeleted}
      />

      {toast ? <Text style={styles.toast}>{toast}</Text> : null}
    </View>
  );
}

function BarberPerfilContent({ barbero, isCompact }: { barbero: Barbero; isCompact: boolean }) {
  return (
    <View>
      <View style={[styles.profileCard, isCompact && styles.fullWidthCard]}>
        <Avatar source={barbero.foto} size={120} />
        <Text style={styles.name}>{barbero.nombre}</Text>
        <Text style={styles.rating}>★ {barbero.promedioCalificacion.toFixed(1)}</Text>
      </View>

      <SectionTitle title="Información" />
      <InfoBox label="Horario Laboral" value={barbero.horarioLaboral} />

      <SectionTitle title="Especialidades" />
      <View style={styles.grid}>
        {barbero.especialidades.length === 0 ? (
          <Text style={styles.empty}>Sin especialidades registradas.</Text>
        ) : (
          barbero.especialidades.map((service) => (
            <View key={service.id} style={[styles.serviceCard, isCompact && styles.fullWidthCard]}>
              <Text style={styles.cardTitle}>{service.nombre}</Text>
              <Text style={styles.cardText}>{service.descripcion || 'Servicio disponible'}</Text>
              <Text style={styles.price}>${service.precio.toLocaleString()}</Text>
              <Text style={styles.duration}>{service.duracionMinutos} min</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const ROLE_LABEL: Record<Role, string> = {
  cliente: 'Cliente',
  barbero: 'Barbero',
  admin: 'Administrador',
};

function describeImage(uri: string) {
  const dataType = /^data:(image\/[\w.+-]+);/.exec(uri)?.[1];
  const extension = /\.(jpe?g|png|webp)(?:\?|$)/i.exec(uri)?.[1]?.toLowerCase();
  const type =
    dataType ??
    (extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg');
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';

  return { type, name: `perfil-${Date.now()}.${ext}` };
}

function OwnProfile({
  profile,
  role,
  isCompact,
  onChangePassword,
  onDelete,
  onEdit,
  onUploadPhoto,
  uploading,
  formatRegistrationDate,
}: {
  profile: SessionProfile | null;
  role: Role;
  isCompact: boolean;
  onChangePassword: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onUploadPhoto: () => void;
  uploading: boolean;
  formatRegistrationDate: (date?: string) => string;
}) {
  return (
    <View>
      <View style={[styles.profileCard, isCompact && styles.fullWidthCard]}>
        <Avatar source={profile?.foto || null} size={120} />
        <Text style={styles.name}>{profile?.nombre || 'Tu nombre'}</Text>
        <Text style={styles.role}>{ROLE_LABEL[role]}</Text>
        <Pressable
          style={[styles.uploadButton, uploading && styles.disabled]}
          onPress={onUploadPhoto}
          disabled={uploading}
        >
          <Text style={styles.uploadButtonText}>
            {uploading ? 'Subiendo...' : 'Actualizar foto'}
          </Text>
        </Pressable>
      </View>

      <SectionTitle title="Información de cuenta" />
      {role !== 'admin' ? (
        <InfoBox label="Usuario" value={profile?.usuario || 'No disponible'} />
      ) : null}
      <InfoBox label="Correo" value={profile?.email || 'No disponible'} />
      <InfoBox label="Teléfono" value={profile?.telefono || 'No registrado'} />
      {profile?.barberia ? <InfoBox label="Barbería" value={profile.barberia.nombre} /> : null}
      <InfoBox
        label="Registrado desde"
        value={formatRegistrationDate(profile?.createdAt ?? undefined)}
      />

      <View style={styles.accountActions}>
        <Pressable style={styles.uploadButton} onPress={onEdit}>
          <Text style={styles.uploadButtonText}>Editar perfil</Text>
        </Pressable>
        <Pressable style={styles.uploadButton} onPress={onChangePassword}>
          <Text style={styles.uploadButtonText}>Cambiar contraseña</Text>
        </Pressable>
        <Pressable style={styles.dangerButton} onPress={onDelete}>
          <Text style={styles.dangerButtonText}>Eliminar mi cuenta</Text>
        </Pressable>
      </View>
    </View>
  );
}

function EditProfileModal({
  open,
  profile,
  onClose,
  onSaved,
}: {
  open: boolean;
  profile: SessionProfile | null;
  onClose: () => void;
  onSaved: (profile: SessionProfile, message: string) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNombre(profile?.nombre ?? '');
      setTelefono(profile?.telefono ?? '');
      setEmail(profile?.email ?? '');
      setError('');
    }
  }, [open, profile]);

  const submit = async () => {
    const changes: Record<string, string> = {};
    if (nombre.trim() !== (profile?.nombre ?? '')) changes.nombre = nombre;
    if (telefono.trim() !== (profile?.telefono ?? '')) changes.telefono = telefono;
    if (email.trim() !== (profile?.email ?? '')) changes.email = email;

    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await api.patch('/auth/me', changes);
      onSaved(response.data.profile as SessionProfile, response.data.message || 'Perfil actualizado.');
    } catch (err) {
      setError(readError(err, 'No fue posible guardar los cambios.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      loading={saving}
      open={open}
      submitLabel="Guardar"
      title="Editar perfil"
      onClose={onClose}
      onSubmit={submit}
    >
      <LabeledInput label="Nombre" value={nombre} onChangeText={setNombre} />
      <LabeledInput
        label="Teléfono"
        value={telefono}
        onChangeText={setTelefono}
        keyboardType="phone-pad"
      />
      <LabeledInput
        label="Correo"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
  );
}

function ChangePasswordModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrent('');
      setPassword('');
      setConfirm('');
      setError('');
    }
  }, [open]);

  const submit = async () => {
    if (password !== confirm) {
      setError('Las contraseñas nuevas no coinciden.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await api.post('/auth/me/password', {
        currentPassword: current,
        newPassword: password,
      });
      onSaved(response.data.message || 'Contraseña actualizada.');
    } catch (err) {
      setError(readError(err, 'No fue posible cambiar la contraseña.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      loading={saving}
      open={open}
      submitLabel="Cambiar contraseña"
      title="Cambiar contraseña"
      onClose={onClose}
      onSubmit={submit}
    >
      <LabeledInput
        label="Contraseña actual"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
      />
      <LabeledInput
        label="Contraseña nueva"
        hint="8 o más caracteres, con letras y números"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <LabeledInput
        label="Confirmar contraseña nueva"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
  );
}

const DELETE_WARNING: Record<Role, string> = {
  cliente:
    'Se cancelarán tus citas próximas y se borrará tu información personal. Tu historial se conserva sin datos que te identifiquen.',
  barbero:
    'Se borrará tu información personal. No podrás eliminar tu cuenta si tienes citas próximas.',
  admin:
    'Se borrará tu cuenta de administrador. Si eres el único administrador de tu barbería, primero debes agregar a otro.',
};

function DeleteAccountModal({
  open,
  role,
  onClose,
  onDeleted,
}: {
  open: boolean;
  role: Role;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword('');
      setConfirmed(false);
      setError('');
    }
  }, [open]);

  const submit = async () => {
    if (!confirmed) {
      setError('Marca la casilla para confirmar que entiendes que no se puede deshacer.');
      return;
    }
    if (!password) {
      setError('Ingresa tu contraseña para continuar.');
      return;
    }

    setDeleting(true);
    setError('');
    try {
      await api.delete('/auth/me', { data: { password } });
      onDeleted();
    } catch (err) {
      setError(readError(err, 'No fue posible eliminar la cuenta.'));
      setDeleting(false);
    }
  };

  return (
    <FormModal
      danger
      loading={deleting}
      open={open}
      submitLabel="Eliminar definitivamente"
      title="Eliminar mi cuenta"
      onClose={onClose}
      onSubmit={submit}
    >
      <Text style={styles.cardText}>{DELETE_WARNING[role]}</Text>
      <Pressable style={styles.confirmRow} onPress={() => setConfirmed((value) => !value)}>
        <View style={[styles.confirmBox, confirmed && styles.confirmBoxChecked]}>
          {confirmed ? <Text style={styles.confirmMark}>✓</Text> : null}
        </View>
        <Text style={[styles.cardText, styles.confirmText]}>
          Entiendo que esta acción no se puede deshacer.
        </Text>
      </Pressable>
      <LabeledInput
        label="Confirma tu contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
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

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoBox}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  headerCompact: {
    alignItems: 'flex-start',
    gap: 10,
  },
  backButton: {
    padding: 8,
    marginRight: 4,
  },
  backText: {
    color: colors.darkGold,
    fontFamily: fonts.title,
    fontSize: 16,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    color: colors.darkGold,
    fontFamily: fonts.medium,
    fontSize: 18,
  },
  title: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 28,
  },
  content: {
    flex: 1,
  },
  profileCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    minWidth: 240,
    padding: 24,
    flexGrow: 1,
    flexBasis: 280,
    marginBottom: 24,
  },
  fullWidthCard: {
    width: '100%',
    minWidth: '100%',
    flexBasis: '100%',
  },
  avatar: {
    backgroundColor: colors.softGold,
  },
  name: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 26,
    textAlign: 'center',
  },
  uploadButton: {
    backgroundColor: colors.gold,
    borderRadius: 8,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  disabled: {
    opacity: 0.45,
  },
  uploadButtonText: {
    color: colors.white,
    fontFamily: fonts.title,
    fontSize: 16,
  },
  role: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 18,
  },
  rating: {
    color: colors.darkGold,
    fontFamily: fonts.title,
    fontSize: 20,
  },
  sectionTitle: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 22,
    marginBottom: 12,
    marginTop: 16,
  },
  infoBox: {
    backgroundColor: colors.background,
    borderRadius: 8,
    marginBottom: 10,
    padding: 12,
  },
  infoLabel: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 14,
    marginBottom: 4,
  },
  infoValue: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 18,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 20,
  },
  serviceCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    minWidth: 200,
    padding: 14,
    flexGrow: 1,
    flexBasis: 200,
  },
  cardTitle: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 18,
  },
  cardText: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  price: {
    color: colors.darkGold,
    fontFamily: fonts.title,
    fontSize: 18,
    marginTop: 4,
  },
  duration: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  empty: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 18,
    marginBottom: 20,
  },
  accountActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
    marginTop: 8,
  },
  dangerButton: {
    alignSelf: 'flex-start',
    borderColor: colors.danger,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  dangerButtonText: {
    color: colors.danger,
    fontFamily: fonts.title,
    fontSize: 16,
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
  error: {
    color: colors.danger,
    fontFamily: fonts.medium,
    fontSize: 18,
  },
  confirmRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  confirmBox: {
    alignItems: 'center',
    borderColor: colors.danger,
    borderRadius: 6,
    borderWidth: 1.5,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  confirmBoxChecked: {
    backgroundColor: colors.danger,
  },
  confirmMark: {
    color: colors.white,
    fontFamily: fonts.title,
    fontSize: 16,
    lineHeight: 18,
  },
  confirmText: {
    flex: 1,
  },
  toast: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: colors.black,
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 16,
    padding: 12,
    borderRadius: 8,
    textAlign: 'center',
  },
});
