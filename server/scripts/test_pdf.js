const fs = require('fs');
const pdf = require('pdf-parse');

let dataBuffer = fs.readFileSync('/Users/alialmurtadh/Downloads/دليل_الطالب_الجامعات_والكليات_الاهلية_2023_2024T.pdf');

pdf(dataBuffer).then(function(data) {
    console.log(data.text.substring(0, 5000)); 
});
