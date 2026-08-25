import os

from flask import Flask
from routes.query_routes import query_bp

app = Flask(__name__)
app.register_blueprint(query_bp)
