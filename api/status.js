const admin = require('firebase-admin');

// Проверка статуса системы
async function getStatus(req, res) {
    try {
        // Проверяем инициализацию Firebase
        if (!admin.apps.length) {
            return res.status(500).json({
                status: 'error',
                message: 'Firebase not initialized'
            });
        }
        
        const db = admin.firestore();
        
        // Получаем статистику
        const [newTracksSnap, knownTracksSnap] = await Promise.all([
            db.collection('new_tracks').count().get(),
            db.collection('known_tracks').count().get()
        ]);
        
        // Получаем последние 5 треков
        const recentTracksSnap = await db.collection('new_tracks')
            .orderBy('addedToLibrary', 'desc')
            .limit(5)
            .get();
        
        const recentTracks = recentTracksSnap.docs.map(doc => ({
            artist: doc.data().artist,
            title: doc.data().title,
            addedAt: doc.data().addedToLibrary?.toDate()?.toISOString()
        }));
        
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            stats: {
                totalNewTracks: newTracksSnap.data().count,
                totalKnownTracks: knownTracksSnap.data().count
            },
            recentTracks: recentTracks,
            version: '1.0.0'
        });
        
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = getStatus;
