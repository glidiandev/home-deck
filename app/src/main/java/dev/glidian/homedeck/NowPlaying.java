package dev.glidian.homedeck;

import android.content.ComponentName;
import android.content.Context;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.SystemClock;

import java.util.List;

/**
 * What's playing right now, from the TV's media sessions: the app, title, artist, play state and position.
 * Nothing is stored or sent anywhere. Needs the user to give Home Deck notification access (see NowPlayingListener).
 */
final class NowPlaying {
    private final Context context;
    private final Handler handler;
    private final Runnable onChange;
    private final MediaSessionManager sessions;
    private volatile MediaController current;
    private boolean watching;

    NowPlaying(Context c, Handler handler, Runnable onChange) {
        this.context = c;
        this.handler = handler;
        this.onChange = onChange;
        this.sessions = c.getSystemService(MediaSessionManager.class);
    }

    /** The listener component, as `cmd notification allow_listener` takes it. */
    static ComponentName listener(Context c) {
        return new ComponentName(c, NowPlayingListener.class);
    }

    /** Starts following the active sessions. False when the user hasn't given access (or the TV has no sessions). */
    boolean start() {
        if (sessions == null) return false;
        try {
            List<MediaController> list = sessions.getActiveSessions(listener(context));
            if (!watching) sessions.addOnActiveSessionsChangedListener(sessionsChanged, listener(context), handler);
            watching = true;
            pick(list);
            return true;
        } catch (SecurityException e) {
            stop();
            return false;
        }
    }

    void stop() {
        if (watching && sessions != null) sessions.removeOnActiveSessionsChangedListener(sessionsChanged);
        watching = false;
        follow(null);
    }

    private final MediaSessionManager.OnActiveSessionsChangedListener sessionsChanged = this::pick;

    /** Prefers a session that is playing; otherwise one that is paused with something loaded. */
    private void pick(List<MediaController> list) {
        MediaController best = null;
        if (list != null) {
            for (MediaController c : list) {
                if (!hasTitle(c)) continue;
                if (stateOf(c) == PlaybackState.STATE_PLAYING) {
                    best = c;
                    break;
                }
                if (best == null && stateOf(c) == PlaybackState.STATE_PAUSED) best = c;
            }
        }
        follow(best);
    }

    private void follow(MediaController c) {
        if (current != null) current.unregisterCallback(callback);
        current = c;
        if (c != null) c.registerCallback(callback, handler);
        onChange.run();
    }

    private final MediaController.Callback callback = new MediaController.Callback() {
        @Override
        public void onPlaybackStateChanged(PlaybackState state) {
            if (stateOf(current) == PlaybackState.STATE_STOPPED || stateOf(current) == PlaybackState.STATE_NONE) {
                start();     // finished: look for another session, or hide
            } else {
                onChange.run();
            }
        }

        @Override
        public void onMetadataChanged(MediaMetadata metadata) {
            onChange.run();
        }

        @Override
        public void onSessionDestroyed() {
            start();
        }
    };

    private static int stateOf(MediaController c) {
        PlaybackState s = c != null ? c.getPlaybackState() : null;
        return s != null ? s.getState() : PlaybackState.STATE_NONE;
    }

    private static boolean hasTitle(MediaController c) {
        MediaMetadata m = c.getMetadata();
        return m != null && m.getString(MediaMetadata.METADATA_KEY_TITLE) != null;
    }

    /** True when there is something to show. */
    boolean active() {
        MediaController c = current;
        return c != null && hasTitle(c);
    }

    String packageName() {
        MediaController c = current;
        return c != null ? c.getPackageName() : null;
    }

    String title() {
        MediaController c = current;
        MediaMetadata m = c != null ? c.getMetadata() : null;
        return m != null ? m.getString(MediaMetadata.METADATA_KEY_TITLE) : null;
    }

    String artist() {
        MediaController c = current;
        MediaMetadata m = c != null ? c.getMetadata() : null;
        if (m == null) return null;
        String a = m.getString(MediaMetadata.METADATA_KEY_ARTIST);
        return a != null ? a : m.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
    }

    String album() {
        MediaController c = current;
        MediaMetadata m = c != null ? c.getMetadata() : null;
        return m != null ? m.getString(MediaMetadata.METADATA_KEY_ALBUM) : null;
    }

    /** The track's length in seconds, or -1 when the app doesn't share it. */
    long totalSeconds() {
        MediaController c = current;
        MediaMetadata m = c != null ? c.getMetadata() : null;
        long d = m != null ? m.getLong(MediaMetadata.METADATA_KEY_DURATION) : 0;
        return d > 0 ? d / 1000 : -1;
    }

    boolean playing() {
        return stateOf(current) == PlaybackState.STATE_PLAYING;
    }

    /** How far into the track, in seconds, or -1 when the app doesn't say. */
    long elapsedSeconds() {
        MediaController c = current;
        PlaybackState s = c != null ? c.getPlaybackState() : null;
        if (s == null || s.getPosition() == PlaybackState.PLAYBACK_POSITION_UNKNOWN) return -1;
        long pos = s.getPosition();
        if (s.getState() == PlaybackState.STATE_PLAYING) {
            pos += (long) ((SystemClock.elapsedRealtime() - s.getLastPositionUpdateTime()) * s.getPlaybackSpeed());
        }
        return Math.max(0, pos / 1000);
    }

    void playPause() {
        MediaController c = current;
        if (c == null) return;
        if (stateOf(c) == PlaybackState.STATE_PLAYING) c.getTransportControls().pause();
        else c.getTransportControls().play();
    }

    /** Next or previous track, only if the app says it can. True when it was asked to skip. */
    boolean skip(boolean next) {
        MediaController c = current;
        PlaybackState s = c != null ? c.getPlaybackState() : null;
        long action = next ? PlaybackState.ACTION_SKIP_TO_NEXT : PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        if (s == null || (s.getActions() & action) == 0) return false;
        if (next) c.getTransportControls().skipToNext();
        else c.getTransportControls().skipToPrevious();
        return true;
    }
}
