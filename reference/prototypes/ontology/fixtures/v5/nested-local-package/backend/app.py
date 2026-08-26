from flask import Flask
from routes.query_routes import query_bp
from firebase_config import db

app = Flask(__name__)
app.register_blueprint(query_bp)
