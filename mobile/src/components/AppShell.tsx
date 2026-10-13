import { useState, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts } from '../theme';
import type { AppScreen, Role } from '../types';

const logo = require('../../assets/icon.png');
const homeIcon = require('../../assets/home.png');
const calendarIcon = require('../../assets/calendar.png');
const userIcon = require('../../assets/user.png');
const logoutIcon = require('../../assets/logout.png');

export function AppShell({
  activeScreen,
  brandName,
  children,
  role,
  onLogout,
  onNavigate,
}: {
  activeScreen: AppScreen;
  /** Nombre de la barbería del usuario (o EdgeTimer para clientes). */
  brandName: string;
  children: ReactNode;
  role: Role;
  onLogout: () => void;
  onNavigate: (screen: AppScreen) => void;
}) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 820;
  const [menuOpen, setMenuOpen] = useState(false);

  const menu = (
    <View style={[styles.menuPanel, isDesktop ? styles.sidebar : styles.mobilePanel]}>
      <View style={styles.brandRow}>
        <Image source={logo} style={styles.logo} />
        <Text style={styles.brandText} numberOfLines={1}>
          {brandName}
        </Text>
      </View>

      <MenuButton
        active={activeScreen === 'home'}
        icon={homeIcon}
        label={role === 'admin' ? 'Panel' : 'Home'}
        onPress={() => {
          onNavigate('home');
          setMenuOpen(false);
        }}
      />
      {role !== 'admin' ? (
        <MenuButton
          active={activeScreen === 'agenda'}
          icon={calendarIcon}
          label="Agenda"
          onPress={() => {
            onNavigate('agenda');
            setMenuOpen(false);
          }}
        />
      ) : null}
      <MenuButton
        active={activeScreen === 'perfil'}
        icon={userIcon}
        label="Mi Perfil"
        onPress={() => {
          onNavigate('perfil');
          setMenuOpen(false);
        }}
      />
      <View style={styles.menuSpacer} />
      <MenuButton icon={logoutIcon} label="Cerrar sesión" onPress={onLogout} />
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        {isDesktop ? menu : null}
        <View style={styles.contentArea}>
          {!isDesktop && (
            <View style={styles.mobileHeader}>
              <View style={styles.mobileBrandRow}>
                <Image source={logo} style={styles.mobileLogo} />
                <Text style={styles.brandText} numberOfLines={1}>
                  {brandName}
                </Text>
              </View>
              <Pressable
                onPress={() => setMenuOpen((current) => !current)}
                style={styles.menuToggle}
              >
                <Text style={styles.menuToggleText}>{menuOpen ? 'Cerrar' : 'Menu'}</Text>
              </Pressable>
            </View>
          )}
          {!isDesktop && menuOpen ? menu : null}
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentInner}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

function MenuButton({
  active,
  icon,
  label,
  onPress,
}: {
  active?: boolean;
  icon: number;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuButton,
        active && styles.menuButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Image
        source={icon}
        style={styles.menuIcon}
        resizeMode="contain"
        tintColor={active ? colors.lightGold : colors.darkGold}
      />
      <Text style={[styles.menuText, active && styles.menuTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  shell: {
    flex: 1,
    flexDirection: 'row',
  },
  contentArea: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 24,
    paddingBottom: 60,
  },
  menuPanel: {
    backgroundColor: colors.white,
    borderColor: colors.border,
  },
  sidebar: {
    width: 250,
    borderRightWidth: 1,
    padding: 20,
  },
  mobilePanel: {
    borderBottomWidth: 1,
    padding: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
  },
  mobileBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 12,
  },
  mobileLogo: {
    width: 38,
    height: 38,
    borderRadius: 10,
  },
  brandText: {
    color: colors.black,
    flexShrink: 1,
    fontFamily: fonts.title,
    fontSize: 24,
  },
  menuButton: {
    minHeight: 50,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  menuButtonActive: {
    backgroundColor: colors.black,
  },
  menuIcon: {
    width: 21,
    height: 21,
  },
  menuText: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 20,
  },
  menuTextActive: {
    color: colors.white,
  },
  menuSpacer: {
    flex: 1,
    minHeight: 24,
  },
  mobileHeader: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuToggle: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.gold,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  menuToggleText: {
    color: colors.darkGold,
    fontFamily: fonts.medium,
    fontSize: 18,
  },
  pressed: {
    opacity: 0.82,
  },
});
