import os

from fastapi import FastAPI
from openai import OpenAI

app = FastAPI()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


@app.post("/api/answer")
def answer(question: str):
    response = client.responses.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-5-mini"),
        input=question,
    )
    return {"answer": response.output_text}
