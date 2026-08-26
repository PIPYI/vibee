from flask import Flask

app = Flask(__name__)

@app.route("/x/<id>")
def get_item(id):
    return {"id": id}
