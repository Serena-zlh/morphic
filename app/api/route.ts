
const queryData = {
    "query": "buy a book",
    "user_id": "string",
    "turn_id": "string",
    "session_id": "string",
    "zipcode": "string",
    "search_source": "web",
    "is_eval": false
}


export async function GET(request: Request) {
    try {

        const response = await fetch(process.env.BACKEND_URL + '/search', {
            method: "POST",

            body: JSON.stringify({ query: 'buy a book', search_source: 'web', is_eval: false })
        })

        const data = await response.json()



        // // const data = await streamToString(response.body)
        // console.log('数据过来', response)
        // console.log('数据过来2', data)
        return Response.json(data)
    } catch (error) {
        console.log('错误', error)
    }

}


// export async function GET(request: Request) {
//     const response = await fetch("http://nb-llm-web-server.k8s.nb-prod.com/turn?turn_id=a1bcf3bb-7490-4a83-9e6f-e06803dd7019", {
//         method: "GET",
//         headers: {
//             'Content-Type': 'application/json',
//             'accept': 'application/json'
//         }
//     });
//     const movies = await response.json();
//     console.log(movies);

//     return Response.json(movies)

// }