from flask import Blueprint
from graphrag.query.factory import get_local_search_engine

query_bp = Blueprint("query", __name__)


def run_graphrag_query(question):
    engine = get_local_search_engine()
    return engine.query(question)
