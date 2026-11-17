-- Bounded room membership lookup for fair-play checks; no archived game data.
CREATE TABLE IF NOT EXISTS player_rooms(userId TEXT NOT NULL,roomId TEXT NOT NULL,pending INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(userId,roomId));
