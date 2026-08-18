# 条件语句和循环

# 条件语句 if/elif/else
age = 20

if age < 18:
    print("未成年")
elif age < 30:
    print("青年")
elif age < 60:
    print("中年")
else:
    print("老年")

# 三元表达式（条件表达式）
score = 85
result = "及格" if score >= 60 else "不及格"
print(result)  # 及格

# for 循环
fruits = ["apple", "banana", "cherry"]

for fruit in fruits:
    print(fruit)

# range() 生成数字序列
for i in range(5):  # 0, 1, 2, 3, 4
    print(i)

for i in range(2, 10, 2):  # 2, 4, 6, 8 (起始, 结束, 步长)
    print(i)

# enumerate() 同时获取索引和值
for index, fruit in enumerate(fruits):
    print(f"{index}: {fruit}")

# zip() 同时遍历多个序列
names = ["Alice", "Bob", "Charlie"]
scores = [85, 92, 78]

for name, score in zip(names, scores):
    print(f"{name}: {score}")

# 字典遍历
person = {"name": "Alice", "age": 25, "city": "Beijing"}

for key, value in person.items():
    print(f"{key}: {value}")

# while 循环
count = 0

while count < 5:
    print(count)
    count += 1

# while 循环（break 提前退出）
num = 0

while True:
    if num == 3:
        break
    print(num)
    num += 1

# continue 跳过当前迭代
for i in range(10):
    if i % 2 == 0:
        continue  # 跳过偶数
    print(i)  # 1, 3, 5, 7, 9

# pass 占位符（空语句）
def future_function():
    pass  # 待实现

# 循环中的 else 子句（循环正常结束时执行）
for i in range(5):
    if i == 10:
        break
else:
    print("循环正常结束")  # 因为没有 break，所以会执行

# for-else（找到因子时 break）
num = 17
for i in range(2, int(num ** 0.5) + 1):
    if num % i == 0:
        print(f"{num} 不是质数")
        break
else:
    print(f"{num} 是质数")

# 列表推导式（预告，详细内容在 day-003）
squares = [x ** 2 for x in range(10)]
even_squares = [x ** 2 for x in range(10) if x % 2 == 0]
print(squares)
print(even_squares)
