defmodule MyAppWeb.UserController do
  use MyAppWeb, :controller

  def index(conn, _params) do
    json(conn, %{users: []})
  end

  def create(conn, params) do
    json(conn, %{created: params})
  end
end
