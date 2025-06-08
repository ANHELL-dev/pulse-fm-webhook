const admin = require('firebase-admin');

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };
    
    try {
        if (!admin.apps.length) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    status: 'error',
                    message: 'Firebase not initialized'
                })
            };
        }
        
        const db = admin.firestore();
        
        const [newTracksSnap, knownTracksSnap] = await Promise.all([
            db.collection('new_tracks').count().get(),
            db.collection('known_tracks').count().get()
        ]);
        
        const recentTracksSnap = await db.collection('new_tracks')
            .orderBy('addedToLibrary', 'desc')
            .limit(5)
            .get();
        
        const recentTracks = recentTracksSnap.docs.map(doc => ({
            artist: doc.data().artist,
            title: doc.data().title,
            addedAt: doc.data().addedToLibrary?.toDate()?.toISOString()
        }));
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                status: 'ok',
                timestamp: new Date().toISOString(),
                stats: {
                    totalNewTracks: newTracksSnap.data().count,
                    totalKnownTracks: knownTracksSnap.data().count
                },
                recentTracks: recentTracks,
                version: '1.0.0'
            })
        };
        
    } catch (error) {
        console.error('Status error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                status: 'error',
                message: error.message,
                timestamp: new Date().toISOString()
            })
        };
    }
};
