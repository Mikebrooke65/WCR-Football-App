import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { App } from '@capacitor/app';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { deviceTokensApi } from '../lib/device-tokens-api';
import { supabase } from '../lib/supabase';
import { router } from '../routes';
import { resolvePushRoute } from '../lib/push-routing-logic';

/**
 * Registers this device for push notifications (via Firebase Cloud Messaging)
 * once a user is authenticated, and stores the resulting token in Supabase
 * so Edge Functions can look it up to send notifications.
 *
 * Also reconnects Supabase Realtime when the app returns to the foreground —
 * mobile OSes suspend WebSocket connections while the app is backgrounded,
 * so without this, Team Messaging can appear "frozen" until a manual refresh.
 *
 * No-ops entirely on web (Capacitor.isNativePlatform() is false there) —
 * this only does anything inside the native iOS/Android app.
 */
// Tracks the token registered by this device for the currently signed-in
// user, so we can remove it if they sign out (matters most on shared
// devices — a signed-out device shouldn't keep receiving another user's
// push notifications). Capacitor doesn't expose a "get current token"
// getter, so we have to remember it ourselves from the 'registration' event.
let lastRegisteredToken: string | null = null;

export function usePushNotifications() {
  const { isAuthenticated, user } = useAuth();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Realtime reconnect on app resume — safe to register regardless of auth state
    const appStateListener = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        supabase.realtime.connect();
      }
    });

    return () => {
      appStateListener.remove();
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    if (!isAuthenticated || !user) {
      // Signed out while the app is running — stop this device receiving
      // pushes for the user that just signed out
      if (lastRegisteredToken) {
        const tokenToRemove = lastRegisteredToken;
        lastRegisteredToken = null;
        deviceTokensApi.removeToken(tokenToRemove).catch((err) => {
          console.error('Failed to remove device token on sign out:', err);
        });
      }
      return;
    }

    let registrationListener: { remove: () => void } | undefined;
    let errorListener: { remove: () => void } | undefined;
    let receivedListener: { remove: () => void } | undefined;
    let actionListener: { remove: () => void } | undefined;

    const setup = async () => {
      const permission = await PushNotifications.checkPermissions();

      if (permission.receive === 'prompt') {
        const requested = await PushNotifications.requestPermissions();
        if (requested.receive !== 'granted') {
          console.log('Push notification permission denied');
          return;
        }
      } else if (permission.receive !== 'granted') {
        console.log('Push notification permission not granted:', permission.receive);
        return;
      }

      registrationListener = await PushNotifications.addListener('registration', async (token) => {
        const platform = Capacitor.getPlatform() as 'ios' | 'android';
        try {
          await deviceTokensApi.registerToken(token.value, platform);
          lastRegisteredToken = token.value;
          console.log('Device token registered for push notifications');
        } catch (err) {
          console.error('Failed to register device token:', err);
        }
      });

      errorListener = await PushNotifications.addListener('registrationError', (err) => {
        console.error('Push notification registration error:', err);
      });

      // Fires only while the app is in the foreground. Android never shows
      // its own system banner in that state (by design), so without this
      // listener a message arriving while the app is open produces nothing
      // visible at all. Routes by the push's `data` payload (V1.7 Piece B,
      // `push-routing-logic.ts`) — a team message has none and falls back
      // to Messaging, same as before; an RSVP reminder (`type:
      // 'event_rsvp'`) routes straight to that event on Schedule.
      receivedListener = await PushNotifications.addListener(
        'pushNotificationReceived',
        (notification) => {
          const title = notification.title || 'New message';
          const body = notification.body || undefined;
          const route = resolvePushRoute(notification.data);
          toast(title, {
            description: body,
            action: {
              label: 'View',
              onClick: () => router.navigate(route),
            },
          });
        }
      );

      // Fires when the user taps a notification that the OS delivered while
      // the app was backgrounded or not running. Deep-links per the same
      // data-payload routing as above.
      actionListener = await PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (action) => {
          router.navigate(resolvePushRoute(action.notification.data));
        }
      );

      await PushNotifications.register();
    };

    setup();

    return () => {
      registrationListener?.remove();
      errorListener?.remove();
      receivedListener?.remove();
      actionListener?.remove();
    };
  }, [isAuthenticated, user]);
}
