package dev.glidian.homedeck;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * The opt-in Home button helper, for TVs (Google TV, mostly) that keep sending Home to their own home screen even
 * after Home Deck is set as the home app. Off until the user turns it on in Jump To.
 *
 * It does two small things and nothing else:
 * - The remote's Home button opens Home Deck. Every other key goes on untouched.
 * - If one of Google's own TV home screens comes to the front anyway (after the TV wakes up, say), Home Deck opens
 *   over it. Android only tells it about those home screens (packageNames in home_key_service.xml), so it never
 *   learns what other apps are open, and it reads no screen content.
 *
 * Trade-offs while it's on: holding Home no longer opens the TV's own quick panel, and on some TVs Android stops
 * repeating a held volume key (the same as any app that watches keys).
 */
public class HomeKeyService extends AccessibilityService {
    private long lastOpen;

    @Override
    protected boolean onKeyEvent(KeyEvent e) {
        if (e.getKeyCode() != KeyEvent.KEYCODE_HOME) return false;
        if (e.getAction() == KeyEvent.ACTION_UP && !e.isCanceled()) openHomeDeck();
        return true;   // both halves of the press, so the TV's own home screen never sees it
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // only Google's home screens are reported (see the service's XML), so any window change here is one of them
        if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) openHomeDeck();
    }

    private void openHomeDeck() {
        long now = SystemClock.uptimeMillis();
        if (now - lastOpen < 800) return;   // a key press and the window change it causes count once
        lastOpen = now;
        Intent i = new Intent(this, HomeActivity.class)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_HOME)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        try {
            startActivity(i);
        } catch (RuntimeException ignored) {
            // nothing to fall back to: the TV keeps doing what it would have done
        }
    }

    @Override
    public void onInterrupt() {
    }
}
