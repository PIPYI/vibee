require "sinatra"

get "/api/users/:id" do
  User.find(params[:id]).to_json
end

post "/api/users" do
  User.create(params).to_json
end
