defmodule MyAppWeb.Router do
  use Phoenix.Router

  get "/api/users", MyAppWeb.UserController, :index
  post "/api/users", MyAppWeb.UserController, :create
end
