import sqlite3

conn = sqlite3.connect("WatchTracker/watches.db")

conn.execute("""
    CREATE TABLE IF NOT EXISTS watches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand TEXT NOT NULL,
        model TEXT NOT NULL,
        movement TEXT,
        price REAL,
        date_acquired TEXT,
        notes TEXT    
    )
""")
conn.commit()

conn.execute("DELETE FROM watches;")
conn.execute("DELETE FROM sqlite_sequence WHERE name='watches';")

watches = [
    (
        "Seiko",   
        "Metronome Monotone Watch Black", 
        None,                        
        353.00, 
        None, 
        "Black dial"
    ),
    (
        "Citizen", 
        "Eco-Drive 180",
        "Eco-Drive (solar quartz)", 
        179.00, 
        None, 
        "Green strap"
    ),
    (
        "Tissot", 
        "Le Locle Powermatic 80",     
        "Powermatic 80 (automatic)", 
        572.00, 
        None,
        "White dial"
    ),
    (
        "Orient", 
        "Sun Moon Open Heart",     
        "Automatic",               
        455.00, 
        None, 
        "Moon phase complication"
    ),
]

conn.executemany(
    "INSERT INTO watches (brand, model, movement, price, date_acquired, notes) VALUES (?, ?, ?, ?, ?, ?)",
    watches
)
conn.commit()
conn.close()

print(f"Inserted {len(watches)} watches.")