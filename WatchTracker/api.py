import sqlite3
from fastapi import FastAPI, HTTPException
from pathlib import Path

from pydantic import BaseModel


DB_PATH = Path(__file__).parent / "watches.db"

class WatchCreate(BaseModel):
    brand:str
    model: str
    movement : str | None = None
    price: float | None = None
    date_acquired: str | None = None
    notes : str | None = None

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn
    
app = FastAPI()

@app.get("/watches")
def get_watches(limit:int = 10):
    conn = get_db()
    rows = conn.execute("SELECT * FROM watches").fetchall()
    conn.close()
    return [dict(row) for row in rows][:limit]

@app.get("/watches/id/{watch_id}")
def get_watch_by_id(watch_id : int):
    conn = get_db()
    rows = conn.execute(f"SELECT * FROM watches WHERE id = {watch_id}").fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.get("/watches/name/{watch_name}")
def get_watch_by_name(watch_name: str):
    
    search = f'%{watch_name}%'
    conn = get_db()
    rows = conn.execute("SELECT * FROM watches WHERE model LIKE ?", (search,)).fetchall()
    rows += conn.execute("SELECT * FROM watches WHERE brand LIKE ?", (search,)).fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.post("/watches/add_watch")
def add_watch(watch:WatchCreate):
    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO watches (brand, model, movement, price, date_acquired, notes) VALUES (?, ?, ?, ?, ?, ?)",
        (watch.brand, watch.model, watch.movement, watch.price, watch.date_acquired, watch.notes)
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return {"id": new_id, **watch.model_dump()}
    
    
# if __name__ == "__main__":
#     get_watch_by_name("Citizen")